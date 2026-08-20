// The handover to the approach-path traversal.
//
// The walk described in docs/trailheads/research-roads.md §A4 needs two
// things: a way to put a trailhead onto the road graph, and a way to step from
// one edge to the next. Both are here, so the traversal task writes the walk
// and its rules rather than the plumbing.
//
// The shape of the walk, for the task that writes it:
//
//   1. `snapTrailhead(store, { lon, lat })` gives the nearest edges, closest
//      first, with the metres from the trailhead to the edge. A trailhead more
//      than the search radius from any edge has no approach — report it, do
//      not stretch the radius until something matches. The research found a
//      naive 1.3 km box picked the wrong road twice in eight.
//   2. `loadTraversalEdges(store)` reads every edge once; `buildAdjacency`
//      turns them into a node-to-edges map. The whole graph is a few hundred
//      thousand edges, so it fits in memory and needs no database round trip
//      per step.
//   3. Walk outward from the snapped edge's nodes. Stop on an edge with
//      `approachTerminus` — maintenance level 4 or 5, a road built for
//      passenger comfort. State highways are not in these sources, so add
//      TIGER before treating a highway as a stop.
//   4. Along the chosen path take the maximum `vehicleRank` and the maximum
//      `surfaceRank`, and keep the edge that set each one. That edge id is the
//      explanation: "the last 6.2 mi of FR 3512 is high-clearance gravel."
//   5. Seasonal windows are not on the edge. Join through
//      `roadcore_mvum_link` to `mvum_season_window` for the segments on the
//      path and intersect the windows. An edge with no window has no seasonal
//      data — never read that as open all year.

import { metresBetween, buildAdjacency, type GraphEdge } from "./topology";
import { sqlLiteral, type RoadStore } from "./store";

export { buildAdjacency } from "./topology";
export type { Adjacency, GraphEdge } from "./topology";

/** Metres per degree of latitude, as in topology.ts. */
const METRES_PER_DEGREE_LAT = 111_320;

/** Default radius for snapping a trailhead to the road graph. */
export const DEFAULT_SNAP_RADIUS_M = 250;

export interface SnapOptions {
  lon: number;
  lat: number;
  /** Search radius in metres. Defaults to `DEFAULT_SNAP_RADIUS_M`. */
  radiusMetres?: number;
  /** How many candidates to return, closest first. */
  limit?: number;
}

export interface SnapCandidate {
  edgeId: string;
  segmentKey: string;
  source: string;
  routeId: string | null;
  name: string | null;
  fromNode: number;
  toNode: number;
  /** Metres from the trailhead to the nearest point on the edge. */
  distanceMetres: number;
  /** Where on the edge that point sits, 0 at `fromNode` and 1 at `toNode`. */
  positionAlongEdge: number;
  vehicleRequirement: string | null;
  vehicleRank: number | null;
  surface: string | null;
  surfaceRank: number | null;
  maintLevel: string | null;
  maintLevelNum: number | null;
}

/**
 * Find the road edges nearest a trailhead.
 *
 * The database filter is a plane box that the R-tree index can answer, sized
 * so it always reaches at least the requested radius on the ground; the exact
 * distance is then measured properly and the over-wide candidates dropped.
 */
export async function snapTrailhead(
  store: RoadStore,
  options: SnapOptions,
): Promise<SnapCandidate[]> {
  const radius = options.radiusMetres ?? DEFAULT_SNAP_RADIUS_M;
  const limit = options.limit ?? 8;
  const cosLat = Math.max(Math.cos(options.lat * (Math.PI / 180)), 0.02);
  const radiusDegrees = radius / (METRES_PER_DEGREE_LAT * cosLat);

  const rows = await store.all<{
    edge_id: string;
    segment_key: string;
    source: string;
    route_id: string | null;
    name: string | null;
    from_node: number;
    to_node: number;
    near_lon: number;
    near_lat: number;
    position: number;
    vehicle_requirement: string | null;
    vehicle_rank: number | null;
    surface: string | null;
    surface_rank: number | null;
    maint_level: string | null;
    maint_level_num: number | null;
  }>(`WITH probe AS (
        SELECT ST_Point(${sqlLiteral(options.lon)}, ${sqlLiteral(options.lat)}) AS pt
      ), near AS (
        SELECT e.*, p.pt,
               ST_LineLocatePoint(e.geom::LINESTRING_2D, p.pt) AS position
        FROM road_edge e, probe p
        WHERE ST_DWithin(e.geom, p.pt, ${sqlLiteral(radiusDegrees)})
      )
      SELECT edge_id, segment_key, source, route_id, name, from_node, to_node,
             ST_X(ST_LineInterpolatePoint(geom::LINESTRING_2D, position)) AS near_lon,
             ST_Y(ST_LineInterpolatePoint(geom::LINESTRING_2D, position)) AS near_lat,
             position,
             vehicle_requirement, vehicle_rank, surface, surface_rank,
             maint_level, maint_level_num
      FROM near`);

  const probe = { lon: options.lon, lat: options.lat };
  return rows
    .map((row) => ({
      edgeId: row.edge_id,
      segmentKey: row.segment_key,
      source: row.source,
      routeId: row.route_id,
      name: row.name,
      fromNode: row.from_node,
      toNode: row.to_node,
      distanceMetres: metresBetween(probe, { lon: row.near_lon, lat: row.near_lat }),
      positionAlongEdge: row.position,
      vehicleRequirement: row.vehicle_requirement,
      vehicleRank: row.vehicle_rank,
      surface: row.surface,
      surfaceRank: row.surface_rank,
      maintLevel: row.maint_level,
      maintLevelNum: row.maint_level_num,
    }))
    .filter((candidate) => candidate.distanceMetres <= radius)
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, limit);
}

/** One edge as the walk sees it: topology plus the attributes it aggregates. */
export interface TraversalEdge extends GraphEdge {
  segmentKey: string;
  source: string;
  routeId: string | null;
  name: string | null;
  lengthMiles: number | null;
  vehicleRequirement: string | null;
  vehicleRank: number | null;
  surface: string | null;
  surfaceRank: number | null;
  maintLevel: string | null;
  maintLevelNum: number | null;
  /** True where the walk may stop: a maintenance level 4 or 5 road. */
  approachTerminus: boolean;
}

/** Read the whole edge table. A few hundred thousand rows, so read it once. */
export async function loadTraversalEdges(store: RoadStore): Promise<TraversalEdge[]> {
  const rows = await store.all<Record<string, any>>(
    `SELECT edge_id, segment_key, from_node, to_node, length_miles, source,
            route_id, name, vehicle_requirement, vehicle_rank, surface,
            surface_rank, maint_level, maint_level_num, approach_terminus
     FROM road_edge`,
  );
  return rows.map((row) => ({
    edgeId: row.edge_id,
    segmentKey: row.segment_key,
    fromNode: row.from_node,
    toNode: row.to_node,
    lengthMiles: row.length_miles ?? null,
    source: row.source,
    routeId: row.route_id ?? null,
    name: row.name ?? null,
    vehicleRequirement: row.vehicle_requirement ?? null,
    vehicleRank: row.vehicle_rank ?? null,
    surface: row.surface ?? null,
    surfaceRank: row.surface_rank ?? null,
    maintLevel: row.maint_level ?? null,
    maintLevelNum: row.maint_level_num ?? null,
    approachTerminus: row.approach_terminus === true,
  }));
}

/** Convenience: edges keyed by id, for a walk that carries ids rather than objects. */
export function indexEdges(edges: readonly TraversalEdge[]): Map<string, TraversalEdge> {
  const index = new Map<string, TraversalEdge>();
  for (const edge of edges) index.set(edge.edgeId, edge);
  return index;
}

/** The other end of an edge from a node. Self-loops return the same node. */
export function otherNode(edge: GraphEdge, node: number): number {
  return edge.fromNode === node ? edge.toNode : edge.fromNode;
}

/** Re-exported so a caller needs one import to build and walk the graph. */
export { metresBetween };

/** Assemble the adjacency map straight from the store. */
export async function loadGraph(store: RoadStore): Promise<{
  edges: TraversalEdge[];
  adjacency: ReturnType<typeof buildAdjacency>;
  byId: Map<string, TraversalEdge>;
}> {
  const edges = await loadTraversalEdges(store);
  return { edges, adjacency: buildAdjacency(edges), byId: indexEdges(edges) };
}
