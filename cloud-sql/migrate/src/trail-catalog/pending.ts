import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { CandidateRejection, sha256, stableJson } from "./graph";
import { candidateProvenance } from "./sources";
import { assertNoExistingSourceOverlap, planPendingSegments } from "./pending-plan";
import { buildCandidate } from "./candidate-source";
import { existingCatalogRoute, finishCandidate, lockCandidateLease, type CandidateLease } from "./jobs";
import type { CandidateReport, ElevatedPoint } from "./types";

// The CLI runs the shared web utilities through tsx.
function sharedModules() {
  const root = resolve(__dirname, "../../../..");
  const utils = require(resolve(root, "web/src/lib/route-utils.ts")) as { pointsToLineStringZ(points: ElevatedPoint[]): string; encodePolyline6(points: ElevatedPoint[]): string };
  return utils;
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
      lat,lng,boundary FROM trail_catalog_locked_places()`);
    for (const place of boundPlaces) if (stableJson(place) !== stableJson(currentPlaces.rows.find(p => p.id === place.id))) throw new CandidateRejection("catalog_binding_changed_requires_review", place.id);
    const states = [...new Set(boundPlaces.map(p => p.stateCode).filter(Boolean))], countries = [...new Set(boundPlaces.map(p => p.countryCode).filter(Boolean))];
    const stateCode = candidate.trailhead.stateCode ?? (states.length === 1 ? states[0] : null), countryCode = candidate.trailhead.countryCode ?? (countries.length === 1 ? countries[0] : null);
    if (!stateCode || !countryCode) throw new CandidateRejection("route_region_missing_or_ambiguous");
    if (lease.artifact.snapshots.length !== candidate.input.source.snapshots.length) throw new CandidateRejection("durable_source_hash_mismatch");
    const snapshots = lease.artifact.snapshots.map((snapshot, i) => {
      if (sha256(snapshot.body) !== snapshot.sha256 || snapshot.sha256 !== candidate.input.source.snapshots[i].sha256) throw new CandidateRejection("durable_source_hash_mismatch");
      return JSON.parse(snapshot.body);
    });
    const rebuilt = buildCandidate(candidate.input, snapshots, { trailhead: candidate.trailhead, objective: candidate.objective, endTrailhead: candidate.endTrailhead });
    if (stableJson({ points: rebuilt.points, edges: rebuilt.edges }) !== stableJson({ points: candidate.points, edges: candidate.edges }) || rebuilt.geometryHash !== candidate.geometryHash) throw new CandidateRejection("durable_source_geometry_mismatch");
    if (candidate.elevatedPoints.length !== rebuilt.points.length || candidate.elevatedPoints.some((point, i) => point.lat !== rebuilt.points[i].lat || point.lng !== rebuilt.points[i].lng || !Number.isFinite(point.ele))) throw new CandidateRejection("elevation_source_vertex_mismatch");
    if (stableJson(candidateProvenance(rebuilt,candidate.elevationLineage)) !== stableJson(candidate.provenance)) throw new CandidateRejection("durable_source_provenance_mismatch");
    const duplicate = await existingCatalogRoute(client, candidate);
    if (duplicate) throw new CandidateRejection("existing_catalog_route_requires_review", duplicate);
    const shared = sharedModules();
    const plan = await planPendingSegments(client, candidate, { lockExisting: true });
    const references: { segmentId: string; direction: "forward" | "reverse"; routeStartIndex: number; routeEndIndex: number }[] = [];
    for (const segment of plan.segments) {
      const start = segment.routeStartIndex, end = segment.routeEndIndex;
      const provenance = segment.provenance;
      const create = async () => {
        const wkt = shared.pointsToLineStringZ(segment.points);
        // Recheck after earlier new spans in this same transaction were inserted.
        await assertNoExistingSourceOverlap(client, candidate, segment, shared);
        const id = `trail-seg-${randomUUID()}`;
        const names = segment.names;
        await client.query("SELECT set_config('peaks.trail_candidate_span_start',$1,true),set_config('peaks.trail_candidate_span_end',$2,true)", [String(start), String(end)]);
        await client.query(`INSERT INTO segments(id,name,path,polyline6,distance,gain,gain_loss,provenance,trail_names)
          SELECT $1,$2,p.path,$4,ST_Length(p.path),stats.gain,stats.loss,$5::jsonb,$6::text[]
          FROM (SELECT ST_GeomFromText($3,4326)::geography AS path) p CROSS JOIN LATERAL route_elevation_stats(p.path) stats`,
        [id, names[0] ?? null, wkt, shared.encodePolyline6(segment.points), JSON.stringify(provenance), names]);
        return id;
      };
      if (segment.type === "existing") {
        references.push({ segmentId: segment.existingSegmentId!, direction: segment.direction!, routeStartIndex: start, routeEndIndex: end });
      } else references.push({ segmentId: await create(), direction: "forward", routeStartIndex: start, routeEndIndex: end });
    }
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
    const report: CandidateReport = { sourceKey: candidate.input.sourceKey, name: candidate.input.name, outcome: "admitted", reason: null, geometryHash: candidate.geometryHash, distanceM: candidate.distanceM, gainM: candidate.gainM, mappedFraction: 1, usedWayIds: candidate.usedWayIds, usedFeatureIds: candidate.usedFeatureIds, pendingReady: true, routeId, writeAction: "created", segmentIds: references.map(r => r.segmentId), segments: references, reusedLengthM: plan.reusedLengthM };
    await finishCandidate(client, lease, routeId, report, null);
    await client.query("COMMIT");
    return report;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
