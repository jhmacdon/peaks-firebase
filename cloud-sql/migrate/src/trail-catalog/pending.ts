import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { CandidateRejection, buildOsmCandidate, sha256, stableJson } from "./graph";
import { segmentProvenance } from "./sources";
import { existingCatalogRoute, finishCandidate, lockCandidateLease, type CandidateLease } from "./jobs";
import type { CandidateReport, ElevatedPoint, ReadyCandidate } from "./types";

type Proposed = { type: "new" | "existing" | "split"; points: ElevatedPoint[]; routeStartIndex: number; routeEndIndex: number; existingSegmentId?: string; direction?: "forward" | "reverse" };
// Runtime loading keeps the existing web matcher authoritative without copying it
// into the migration compiler's src-only project. The CLI runs through tsx.
function sharedModules() {
  const root = resolve(__dirname, "../../../..");
  const matcher = require(resolve(root, "web/src/lib/segment-matcher-core.ts")) as { analyzeRouteSegmentsWithClient(client: PoolClient, points: ElevatedPoint[], options: unknown): Promise<{ segments: Proposed[]; splits: unknown[] }> };
  const reuse = require(resolve(root, "web/src/lib/route-segment-reuse.ts")) as { chooseActivationSegmentReference(input: unknown): Promise<{ segmentId: string; direction: "forward" | "reverse" }> };
  const utils = require(resolve(root, "web/src/lib/route-utils.ts")) as { pointsToLineStringZ(points: ElevatedPoint[]): string; encodePolyline6(points: ElevatedPoint[]): string };
  return { ...matcher, ...reuse, ...utils };
}

/** Atomic pending write: no route activation, segment splitting, or route renaming. */
export async function writePendingCandidate(client: PoolClient, lease: CandidateLease): Promise<CandidateReport> {
  await client.query("BEGIN");
  try {
    await lockCandidateLease(client, lease);
    await client.query("SELECT set_config('peaks.trail_candidate_source_key',$1,true),set_config('peaks.trail_candidate_lease_token',$2,true)", [lease.sourceKey, lease.token]);
    if (sha256(stableJson(lease.artifact)) !== lease.inputHash) throw new CandidateRejection("durable_artifact_hash_mismatch");
    // Serialize these bounded imports so two workers cannot create the same new shared span.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('trail_catalog_pending_writer',0))");
    const candidate = lease.artifact.candidate;
    const boundPlaces = [candidate.trailhead, candidate.objective, candidate.endTrailhead].filter((p): p is NonNullable<typeof p> => Boolean(p));
    const currentPlaces = await client.query(`SELECT id,name,features,state_code AS "stateCode",country_code AS "countryCode",
      ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng,ST_AsGeoJSON(boundary::geometry)::json AS boundary
      FROM destinations WHERE id=ANY($1::text[]) FOR SHARE`, [boundPlaces.map(p => p.id)]);
    for (const place of boundPlaces) if (stableJson(place) !== stableJson(currentPlaces.rows.find(p => p.id === place.id))) throw new CandidateRejection("catalog_binding_changed_requires_review", place.id);
    const states = [...new Set(boundPlaces.map(p => p.stateCode).filter(Boolean))], countries = [...new Set(boundPlaces.map(p => p.countryCode).filter(Boolean))];
    const stateCode = candidate.trailhead.stateCode ?? (states.length === 1 ? states[0] : null), countryCode = candidate.trailhead.countryCode ?? (countries.length === 1 ? countries[0] : null);
    if (!stateCode || !countryCode) throw new CandidateRejection("route_region_missing_or_ambiguous");
    if (lease.artifact.snapshots.length !== candidate.input.source.snapshots.length) throw new CandidateRejection("durable_source_hash_mismatch");
    const snapshots = lease.artifact.snapshots.map((snapshot, i) => {
      if (sha256(snapshot.body) !== snapshot.sha256 || snapshot.sha256 !== candidate.input.source.snapshots[i].sha256) throw new CandidateRejection("durable_source_hash_mismatch");
      return JSON.parse(snapshot.body);
    });
    const rebuilt = buildOsmCandidate(candidate.input, snapshots, { trailhead: candidate.trailhead, objective: candidate.objective, endTrailhead: candidate.endTrailhead });
    if (stableJson({ points: rebuilt.points, edges: rebuilt.edges }) !== stableJson({ points: candidate.points, edges: candidate.edges }) || rebuilt.geometryHash !== candidate.geometryHash) throw new CandidateRejection("durable_source_geometry_mismatch");
    if (candidate.elevatedPoints.length !== rebuilt.points.length || candidate.elevatedPoints.some((point, i) => point.lat !== rebuilt.points[i].lat || point.lng !== rebuilt.points[i].lng || !Number.isFinite(point.ele))) throw new CandidateRejection("elevation_source_vertex_mismatch");
    const duplicate = await existingCatalogRoute(client, candidate);
    if (duplicate) throw new CandidateRejection("existing_catalog_route_requires_review", duplicate);
    const shared = sharedModules();
    const decomposition = await shared.analyzeRouteSegmentsWithClient(client, candidate.elevatedPoints, { exactOnly: true, allowExistingSplits: false, requiredCutIndices: candidate.requiredCutIndices });
    if (!decomposition.segments.length || decomposition.splits.length || decomposition.segments.some(s => s.type === "split")) throw new CandidateRejection("existing_segment_split_requires_review");
    let expectedStart = 0, reusedLengthM = 0;
    const references: { segmentId: string; direction: "forward" | "reverse"; routeStartIndex: number; routeEndIndex: number }[] = [];
    for (const segment of decomposition.segments) {
      const start = segment.routeStartIndex, end = segment.routeEndIndex;
      if (start !== expectedStart || end <= start || stableJson(segment.points.map(({ lat, lng, ele }) => ({ lat, lng, ele }))) !== stableJson(candidate.elevatedPoints.slice(start, end + 1).map(({ lat, lng, ele }) => ({ lat, lng, ele })))) throw new CandidateRejection("matcher_source_interval_mismatch");
      expectedStart = end;
      const provenance = segmentProvenance(candidate, start, end), ids = provenance.osm_way_ids as number[];
      const create = async () => {
        const wkt = shared.pointsToLineStringZ(segment.points);
        // Same source geometry with different XYZ needs review; never hide it as a duplicate span.
        const overlaps = await client.query(`SELECT s.id FROM segments s WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.provenance->'osm_way_ids') source_id WHERE source_id=ANY($2::text[]))
          AND ST_DWithin(s.path,ST_GeomFromText($1,4326)::geography,5)
          AND ST_Length(ST_CollectionExtract(ST_Intersection(ST_GeomFromText($1,4326),ST_Buffer(s.path,5)::geometry),2)::geography)>GREATEST(25,ST_Length(ST_GeomFromText($1,4326)::geography)*0.2) LIMIT 1`, [wkt, ids.map(String)]);
        if (overlaps.rows.length) throw new CandidateRejection("existing_source_geometry_requires_review", overlaps.rows[0].id);
        const id = `trail-seg-${randomUUID()}`;
        const names = [...new Set(candidate.edges.slice(start, end).flatMap(e => e.names))];
        await client.query("SELECT set_config('peaks.trail_candidate_span_start',$1,true),set_config('peaks.trail_candidate_span_end',$2,true)", [String(start), String(end)]);
        await client.query(`INSERT INTO segments(id,name,path,polyline6,distance,gain,gain_loss,provenance,trail_names)
          SELECT $1,$2,p.path,$4,ST_Length(p.path),stats.gain,stats.loss,$5::jsonb,$6::text[]
          FROM (SELECT ST_GeomFromText($3,4326)::geography AS path) p CROSS JOIN LATERAL route_elevation_stats(p.path) stats`,
        [id, names[0] ?? null, wkt, shared.encodePolyline6(segment.points), JSON.stringify(provenance), names]);
        return id;
      };
      if (segment.type === "existing") {
        if (!segment.existingSegmentId || !segment.direction) throw new CandidateRejection("invalid_existing_segment_reference");
        const stored = await client.query("SELECT provenance->'osm_way_ids' AS ids FROM segments WHERE id=$1 FOR UPDATE", [segment.existingSegmentId]);
        if (stableJson([...(stored.rows[0]?.ids ?? [])].sort((a,b) => a-b)) !== stableJson(ids)) throw new CandidateRejection("existing_segment_source_interval_mismatch", segment.existingSegmentId);
        references.push({ ...await shared.chooseActivationSegmentReference({ client, existingSegmentId: segment.existingSegmentId, points: segment.points, direction: segment.direction, routeProvenance: JSON.stringify(provenance), requireReuse: true, createRouteSpecificSegment: create }), routeStartIndex: start, routeEndIndex: end });
        reusedLengthM += candidate.elevatedPoints[end].dist - candidate.elevatedPoints[start].dist;
      } else references.push({ segmentId: await create(), direction: "forward", routeStartIndex: start, routeEndIndex: end });
    }
    if (expectedStart !== candidate.points.length - 1) throw new CandidateRejection("matcher_incomplete_route");
    const routeId = lease.proposedRouteId, lineage = candidate.elevationLineage;
    await client.query(`INSERT INTO routes(id,name,aliases,kind,trailhead_destination_id,objective_destination_id,state_code,country_code,
      path,polyline6,owner,distance,gain,gain_loss,shape,status,completion,provenance,
      elevation_source,elevation_source_url,elevation_attribution,elevation_license_url,elevation_retrieved_at)
      SELECT $1,$2,$3::text[],$4,$5,$6,$7,$8,p.path,$10,'peaks',ST_Length(p.path),stats.gain,stats.loss,$11::route_shape,'pending','none',$12::jsonb,
      $13,$14,$15,$16,$17::timestamptz FROM (SELECT ST_GeomFromText($9,4326)::geography AS path) p CROSS JOIN LATERAL route_elevation_stats(p.path) stats`,
    [routeId, candidate.input.name, candidate.input.aliases ?? [], candidate.input.kind, candidate.trailhead.id, candidate.objective?.id ?? null, stateCode, countryCode,
      shared.pointsToLineStringZ(candidate.elevatedPoints), shared.encodePolyline6(candidate.elevatedPoints), candidate.shape, JSON.stringify(candidate.provenance), lineage.source, lineage.sourceUrl, lineage.attribution, lineage.licenseUrl, lineage.retrievedAt]);
    for (let i = 0; i < references.length; i++) await client.query("INSERT INTO route_segments(route_id,segment_id,ordinal,direction) VALUES($1,$2,$3,$4)", [routeId, references[i].segmentId, i, references[i].direction]);
    const placeIds = [...new Set([candidate.trailhead.id, candidate.objective?.id, candidate.endTrailhead?.id].filter((id): id is string => Boolean(id)))];
    for (let i = 0; i < placeIds.length; i++) await client.query("INSERT INTO route_destinations(route_id,destination_id,ordinal) VALUES($1,$2,$3)", [routeId, placeIds[i], i]);
    const checks = await client.query("SELECT peaks_route_passes_publish_integrity($1,NULL,'pending') AS valid", [routeId]);
    if (!checks.rows[0]?.valid) throw new CandidateRejection("pending_route_integrity_failed");
    const report: CandidateReport = { sourceKey: candidate.input.sourceKey, name: candidate.input.name, outcome: "admitted", reason: null, geometryHash: candidate.geometryHash, distanceM: candidate.distanceM, gainM: candidate.gainM, mappedFraction: 1, usedWayIds: candidate.usedWayIds, pendingReady: true, routeId, writeAction: "created", segmentIds: references.map(r => r.segmentId), segments: references, reusedLengthM };
    await finishCandidate(client, lease, routeId, report, null);
    await client.query("COMMIT");
    return report;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
