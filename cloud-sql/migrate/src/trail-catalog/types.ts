/** Reviewed inputs only. This pilot does not infer catalog IDs or fabricate connectors. */
export type TrailKind = "summit" | "destination" | "loop" | "traverse";
export type Point = { lat: number; lng: number };
export type ElevatedPoint = Point & { ele: number; dist: number };

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
  /** For an attested loop, traverse every selected edge once from startNodeId. */
  terrainReviews?: { wayId: number; sourceUrl: string; checkedAt: string; note: string }[];
  /** Name-only evidence when no named OSM hiking relation attests to the route. */
  identity?: { name: string; sourceUrl: string; publisher: "usfs" | "wta" | "alltrails" };
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

export interface SourceEdge {
  wayId: number;
  startNodeId: number;
  endNodeId: number;
  names: string[];
}

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
  distanceM: number;
  mappedFraction: number;
  sourceHashes: string[];
  geometryHash: string;
  attestation: string;
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
  outcome: "admitted" | "rejected";
  reason: string | null;
  detail?: string;
  geometryHash?: string;
  sourceHashes?: string[];
  distanceM?: number;
  gainM?: number;
  mappedFraction?: number;
  usedWayIds?: number[];
  requiredCutIndices?: number[];
  pendingReady?: boolean;
  pendingBlocker?: string;
  routeId?: string;
  writeAction?: "created" | "existing";
  segmentIds?: string[];
  reusedLengthM?: number;
  segments?: { segmentId: string; direction: "forward" | "reverse"; routeStartIndex: number; routeEndIndex: number }[];
}
