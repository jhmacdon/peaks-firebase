import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { CandidateRejection, stableJson } from "./graph";
import { provenanceSourceIds, segmentProvenance } from "./sources";
import type { ElevatedPoint, ReadyCandidate } from "./types";

type Proposed = { type: "new" | "existing" | "split"; points: ElevatedPoint[]; routeStartIndex: number; routeEndIndex: number; existingSegmentId?: string; direction?: "forward" | "reverse" };
type PlanClient = Pick<PoolClient, "query">;
export type PlannedSegment = Proposed & { provenance: Record<string, unknown>; sourceIds: string[]; names: string[] };
export type PendingPlanModules = {
  analyzeRouteSegmentsWithClient(client: PlanClient, points: ElevatedPoint[], options: unknown): Promise<{ segments: Proposed[]; splits: unknown[] }>;
  existingSegmentIsSafeToReuse(client: PlanClient, segmentId: string, points: ElevatedPoint[], direction: "forward" | "reverse", provenance: string, lockExisting?: boolean): Promise<boolean>;
  pointsToLineStringZ(points: ElevatedPoint[]): string;
};
// The dry planner and writer use the same matcher and existing SQL reuse proof.
function sharedModules(): PendingPlanModules {
  const root = resolve(__dirname, "../../../..");
  return {
    ...require(resolve(root, "web/src/lib/segment-matcher-core.ts")),
    ...require(resolve(root, "web/src/lib/route-segment-reuse.ts")),
    ...require(resolve(root, "web/src/lib/route-utils.ts")),
  };
}

export async function assertNoExistingSourceOverlap(client: PlanClient, candidate: ReadyCandidate, segment: PlannedSegment, modules: Pick<PendingPlanModules, "pointsToLineStringZ"> = sharedModules()): Promise<void> {
  // Same source geometry with different XYZ requires review, including cross-source copies.
  const sourcePredicate = candidate.input.source.type === "usfs-nfs-trails"
    ? "(s.provenance->>'source_kind'='usfs-nfs-trails' AND trail_catalog_usfs_feature_ids(s.provenance->>'source_url') && $2::text[])"
    : "EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.provenance->'osm_way_ids') source_id WHERE source_id=ANY($2::text[]))";
  const overlaps = await client.query(`SELECT s.id FROM segments s WHERE (${sourcePredicate}
    OR (s.provenance->>'source_kind' IN ('openstreetmap','usfs-nfs-trails') AND s.provenance->>'source_kind'<>$3))
    AND ST_DWithin(s.path,ST_GeomFromText($1,4326)::geography,5)
    AND ST_Length(ST_CollectionExtract(ST_Intersection(ST_GeomFromText($1,4326),ST_Buffer(s.path,5)::geometry),2)::geography)>GREATEST(25,ST_Length(ST_GeomFromText($1,4326)::geography)*0.2) LIMIT 1`,
  [modules.pointsToLineStringZ(segment.points), segment.sourceIds, segment.provenance.source_kind]);
  if (overlaps.rows.length) throw new CandidateRejection("existing_source_geometry_requires_review", overlaps.rows[0].id);
}

/** No DML. Dry runs inspect without locks; the writer reruns under its lease and locks. */
export async function planPendingSegments(client: PlanClient, candidate: ReadyCandidate, options: { lockExisting?: boolean; modules?: PendingPlanModules } = {}): Promise<{ segments: PlannedSegment[]; reusedLengthM: number }> {
  const shared = options.modules ?? sharedModules();
  let decomposition: Awaited<ReturnType<PendingPlanModules["analyzeRouteSegmentsWithClient"]>>;
  try { decomposition = await shared.analyzeRouteSegmentsWithClient(client, candidate.elevatedPoints, { exactOnly: true, allowExistingSplits: false, requiredCutIndices: candidate.requiredCutIndices }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "", reason = message.split(":")[0];
    if (["existing_segment_split_requires_review", "exact_candidate_scan_limit_exceeded", "exact_candidate_point_limit_exceeded", "exact_candidate_scan_changed"].includes(reason)) throw new CandidateRejection(reason, message.slice(reason.length + 1));
    throw error;
  }
  if (!decomposition.segments.length || decomposition.splits.length || decomposition.segments.some(segment => segment.type === "split")) throw new CandidateRejection("existing_segment_split_requires_review");
  let expectedStart = 0, reusedLengthM = 0;
  const segments: PlannedSegment[] = [];
  for (const segment of decomposition.segments) {
    const start = segment.routeStartIndex, end = segment.routeEndIndex;
    if (start !== expectedStart || end <= start || stableJson(segment.points.map(({ lat, lng, ele }) => ({ lat, lng, ele }))) !== stableJson(candidate.elevatedPoints.slice(start, end + 1).map(({ lat, lng, ele }) => ({ lat, lng, ele })))) throw new CandidateRejection("matcher_source_interval_mismatch");
    expectedStart = end;
    const provenance = segmentProvenance(candidate, start, end), sourceIds = provenanceSourceIds(provenance);
    const planned: PlannedSegment = { ...segment, provenance, sourceIds, names: [...new Set(candidate.edges.slice(start, end).flatMap(edge => edge.names))] };
    if (segment.type === "existing") {
      if (!segment.existingSegmentId || !segment.direction) throw new CandidateRejection("invalid_existing_segment_reference");
      const stored = await client.query(`SELECT provenance FROM segments WHERE id=$1${options.lockExisting ? " FOR UPDATE" : ""}`, [segment.existingSegmentId]);
      if (stored.rows[0]?.provenance?.source_kind !== provenance.source_kind || stableJson(provenanceSourceIds(stored.rows[0]?.provenance ?? {})) !== stableJson(sourceIds)) throw new CandidateRejection("existing_segment_source_interval_mismatch", segment.existingSegmentId);
      if (!await shared.existingSegmentIsSafeToReuse(client, segment.existingSegmentId, segment.points, segment.direction, JSON.stringify(provenance), options.lockExisting === true)) throw new CandidateRejection("existing_segment_reuse_rejected", segment.existingSegmentId);
      reusedLengthM += candidate.elevatedPoints[end].dist - candidate.elevatedPoints[start].dist;
    } else await assertNoExistingSourceOverlap(client, candidate, planned, shared);
    segments.push(planned);
  }
  if (expectedStart !== candidate.points.length - 1) throw new CandidateRejection("matcher_incomplete_route");
  return { segments, reusedLengthM };
}
