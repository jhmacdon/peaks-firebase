/** Reviewed inputs only. This pilot does not infer catalog IDs or fabricate connectors. */
export type TrailKind = "summit" | "destination" | "loop" | "traverse";
export type Point = { lat: number; lng: number };
export type ElevatedPoint = Point & { ele: number; dist: number };
export interface UsfsVertex { featureId: string; part: number; vertex: number }

export interface SourceSnapshot {
  path: string;
  sha256: string;
  url: string;
  retrievedAt: string;
}

export interface PilotCandidateInput {
  /** Stable source identity, independent of display name or file location. */
  sourceKey: string;
  name: string;
  aliases?: string[];
  kind: TrailKind;
  trailheadId: string | null;
  objectiveId: string | null;
  endTrailheadId?: string | null;
  /** The only duplicate trailhead/objective pair allowed in the golden pilot. */
  variant?: "mailbox-old" | "mailbox-new";
  source: {
    type: "osm" | "usfs-nfs-trails";
    snapshots: SourceSnapshot[];
    relationId?: number;
    wayIds?: number[];
    featureIds?: string[];
  };
  /** Source nodes, not projected catalog coordinates. Required for OSM paths. */
  startNodeId?: number;
  endNodeId?: number;
  /** A discovered cycle of exact OSM nodes, including its repeated start. */
  loopNodeIds?: number[];
  /** Exact vertices in the registry's canonical feature/part order. */
  startSourceVertex?: UsfsVertex;
  endSourceVertex?: UsfsVertex;
  /** Exact USFS source coordinates; every consecutive pair must be a source edge. */
  loopSourcePoints?: Point[];
  /** Reviews for difficult or obscure mapped OSM ways. */
  terrainReviews?: { wayId: number; sourceUrl: string; checkedAt: string; note: string }[];
  /** Name-only evidence when no named OSM hiking relation attests to the route. */
  identity?: { name: string; sourceUrl: string; publisher: "usfs" | "wta" | "alltrails" };
  commonDestinationEvidence?: { objectiveId: string; name: string; sourceUrl: string; publisher: "usfs" | "nps" | "wta" | "alltrails"; checkedAt: string; note: string; attestation: "standalone_named_hike" };
  access?: { status: "open" | "closed" | "unknown"; sourceUrl: string; checkedAt: string; note: string };
  /** Store known research gaps as rejections, keeping all golden rows visible. */
  blockedReason?: string;
  /** Optional until import. File: { points: [{lat,lng,ele}], lineage: ... }. */
  elevation?: { path: string; sha256: string };
  /** Independent, source-specific values; distance basis must be explicit. */
  attestedStats?: { sourceUrl: string; distanceM?: number; distanceBasis: "one_way" | "round_trip"; gainM?: number; gainBasis?: "outbound" | "full_trip" | "net_change" | "unspecified" }[];
}

export interface PilotManifest {
  version: 1;
  batchKey: string;
  candidates: PilotCandidateInput[];
}

export interface CatalogPlace extends Point {
  id: string;
  name: string;
  features: string[];
  stateCode: string | null;
  countryCode: string | null;
  boundary?: { type: "Polygon"; coordinates: number[][][] } | null;
}

export interface OsmSourceEdge {
  wayId: number;
  startNodeId: number;
  endNodeId: number;
  names: string[];
}
export interface UsfsSourceEdge { featureId: string; part: number; startVertex: number; endVertex: number; names: string[] }
export type SourceEdge = OsmSourceEdge | UsfsSourceEdge;

export interface BuiltCandidate {
  input: PilotCandidateInput;
  trailhead: CatalogPlace;
  objective: CatalogPlace | null;
  endTrailhead: CatalogPlace | null;
  points: Point[];
  nodeIds: number[];
  /** One assignment per edge: edges[i] describes points[i] -> points[i+1]. */
  edges: SourceEdge[];
  requiredCutIndices: number[];
  usedWayIds: number[];
  usedFeatureIds?: string[];
  distanceM: number;
  mappedFraction: number;
  sourceHashes: string[];
  geometryHash: string;
  attestation: string;
  attestedRouteNames?: string[];
  shape: "out_and_back" | "loop" | "point_to_point";
}

export interface ElevationLineage {
  source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)";
  sourceUrl: string;
  attribution: string;
  licenseUrl: string;
  retrievedAt: string;
  profile: "terrain";
}

export interface ReadyCandidate extends BuiltCandidate {
  elevatedPoints: ElevatedPoint[];
  elevationLineage: ElevationLineage;
  provenance: Record<string, unknown>;
  gainM: number;
  lossM: number;
}

export interface CandidateReport {
  sourceKey: string;
  name: string;
  aliases?: string[];
  namingReason?: string;
  keptSourceKey?: string;
  outcome: "admitted" | "rejected";
  reason: string | null;
  detail?: string;
  geometryHash?: string;
  sourceHashes?: string[];
  distanceM?: number;
  gainM?: number;
  mappedFraction?: number;
  usedWayIds?: number[];
  usedFeatureIds?: string[];
  requiredCutIndices?: number[];
  pendingReady?: boolean;
  pendingBlocker?: string;
  routeId?: string;
  writeAction?: "created" | "existing";
  segmentIds?: string[];
  reusedLengthM?: number;
  segments?: { segmentId: string; direction: "forward" | "reverse"; routeStartIndex: number; routeEndIndex: number }[];
}
