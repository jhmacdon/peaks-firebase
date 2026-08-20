// Node clustering for the road graph.
//
// The approach-path walk in docs/trailheads/research-roads.md §A4 is a graph
// traversal, so the segments have to be turned into edges that share nodes.
// Federal road segments almost meet at their endpoints but rarely to the last
// decimal: neighbouring RoadCore segments differ by centimetres, and a BLM
// route meeting a forest road can be metres out. Endpoints within a tolerance
// therefore become one node.
//
// The grid is laid out in metres, not degrees. Each row of cells is one
// tolerance tall, and its columns are widened by the latitude of the row so a
// cell is one tolerance across on the ground everywhere from Puerto Rico to
// interior Alaska. Every endpoint is then compared against the nine cells
// around it, which is the whole search: two points more than a tolerance apart
// cannot share a cell neighbourhood.
//
// Merging is transitive — a chain of endpoints each within tolerance of the
// next becomes one node even if the ends are further apart. That is the usual
// behaviour of snapping and it is what keeps a road unbroken, but it is why
// the tolerance should stay small.

/** Metres per degree of latitude. Good to a tenth of a percent over the US. */
const METRES_PER_DEGREE_LAT = 111_320;

export interface Endpoint {
  lon: number;
  lat: number;
}

export interface GraphNode {
  lon: number;
  lat: number;
  /** How many segment endpoints landed on this node. */
  endpointCount: number;
}

export interface ClusteredEndpoints {
  /** Node index per input endpoint, in input order. */
  nodeIdByEndpoint: Int32Array;
  /** Node coordinates, indexed by node id. */
  nodes: GraphNode[];
}

/**
 * Distance in metres on the equirectangular approximation.
 *
 * At the tolerances used here — metres, not kilometres — this is within a
 * millimetre of the great-circle distance and much cheaper.
 */
export function metresBetween(a: Endpoint, b: Endpoint): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lon - a.lon) * METRES_PER_DEGREE_LAT * Math.cos(meanLat);
  const dy = (b.lat - a.lat) * METRES_PER_DEGREE_LAT;
  return Math.hypot(dx, dy);
}

/**
 * The same distance, as a SQL expression.
 *
 * Some of the work — matching millions of road vertices against the junction
 * candidates — is far too large to pull into JavaScript, so it runs in DuckDB.
 * This builds the identical formula so there is one definition of "within a
 * tolerance", and `roads-topology.test.ts` runs both over the same pairs and
 * asserts they agree.
 */
export function metresBetweenSql(
  aLon: string,
  aLat: string,
  bLon: string,
  bLat: string,
): string {
  return (
    `sqrt(pow((${bLon} - ${aLon}) * ${METRES_PER_DEGREE_LAT} * ` +
    `cos(radians((${aLat} + ${bLat}) / 2)), 2) + ` +
    `pow((${bLat} - ${aLat}) * ${METRES_PER_DEGREE_LAT}, 2))`
  );
}

/** Longitude degrees that span `toleranceMetres` at the given latitude row. */
function cellWidthDegrees(latDegrees: number, toleranceDegrees: number): number {
  const cosLat = Math.cos(latDegrees * (Math.PI / 180));
  // Clamp so a pole-adjacent row cannot produce an unbounded cell width.
  return toleranceDegrees / Math.max(cosLat, 0.02);
}

class UnionFind {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i += 1) this.parent[i] = i;
    this.rank = new Uint8Array(size);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root]!;
    let walk = index;
    while (this.parent[walk] !== root) {
      const next = this.parent[walk]!;
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA]! < this.rank[rootB]!) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA]! > this.rank[rootB]!) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] = this.rank[rootA]! + 1;
    }
  }
}

/**
 * Merge endpoints that lie within `toleranceMetres` of each other into nodes.
 *
 * Node coordinates are the mean of their members, so a node sits between the
 * segment ends it joins rather than on an arbitrary one of them.
 */
export function clusterEndpoints(
  endpoints: readonly Endpoint[],
  toleranceMetres: number,
): ClusteredEndpoints {
  if (!(toleranceMetres > 0)) throw new Error("clusterEndpoints: tolerance must be positive");
  const count = endpoints.length;
  const nodeIdByEndpoint = new Int32Array(count);
  if (count === 0) return { nodeIdByEndpoint, nodes: [] };

  const toleranceDegrees = toleranceMetres / METRES_PER_DEGREE_LAT;
  const cells = new Map<string, number[]>();
  const rows = new Int32Array(count);
  const cols = new Int32Array(count);

  for (let i = 0; i < count; i += 1) {
    const point = endpoints[i]!;
    const row = Math.floor(point.lat / toleranceDegrees);
    const rowLat = (row + 0.5) * toleranceDegrees;
    const col = Math.floor(point.lon / cellWidthDegrees(rowLat, toleranceDegrees));
    rows[i] = row;
    cols[i] = col;
    const key = `${row}:${col}`;
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [i]);
    else bucket.push(i);
  }

  const merges = new UnionFind(count);
  for (let i = 0; i < count; i += 1) {
    const point = endpoints[i]!;
    const row = rows[i]!;
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      const neighbourRow = row + dRow;
      // Each row has its own column width, so the column of this point has to
      // be recomputed against the neighbouring row's grid.
      const neighbourLat = (neighbourRow + 0.5) * toleranceDegrees;
      const width = cellWidthDegrees(neighbourLat, toleranceDegrees);
      const neighbourCol = Math.floor(point.lon / width);
      for (let dCol = -1; dCol <= 1; dCol += 1) {
        const bucket = cells.get(`${neighbourRow}:${neighbourCol + dCol}`);
        if (bucket === undefined) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          if (metresBetween(point, endpoints[j]!) <= toleranceMetres) merges.union(i, j);
        }
      }
    }
  }

  const nodeIdByRoot = new Map<number, number>();
  const nodes: GraphNode[] = [];
  const sums: { lon: number; lat: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const root = merges.find(i);
    let nodeId = nodeIdByRoot.get(root);
    if (nodeId === undefined) {
      nodeId = nodes.length;
      nodeIdByRoot.set(root, nodeId);
      nodes.push({ lon: 0, lat: 0, endpointCount: 0 });
      sums.push({ lon: 0, lat: 0 });
    }
    nodeIdByEndpoint[i] = nodeId;
    const point = endpoints[i]!;
    sums[nodeId]!.lon += point.lon;
    sums[nodeId]!.lat += point.lat;
    nodes[nodeId]!.endpointCount += 1;
  }
  for (let n = 0; n < nodes.length; n += 1) {
    nodes[n]!.lon = sums[n]!.lon / nodes[n]!.endpointCount;
    nodes[n]!.lat = sums[n]!.lat / nodes[n]!.endpointCount;
  }
  return { nodeIdByEndpoint, nodes };
}

/** One edge of the road graph, as the traversal task consumes it. */
export interface GraphEdge {
  edgeId: string;
  fromNode: number;
  toNode: number;
}

/** Node id to the edges that touch it. Both directions; every edge is two-way. */
export type Adjacency = Map<number, GraphEdge[]>;

/**
 * Build the adjacency list the approach walk needs.
 *
 * Self-loops — an edge whose two endpoints snapped to one node — are kept but
 * listed once, so a walk cannot count them twice.
 */
export function buildAdjacency(edges: readonly GraphEdge[]): Adjacency {
  const adjacency: Adjacency = new Map();
  const attach = (node: number, edge: GraphEdge): void => {
    const list = adjacency.get(node);
    if (list === undefined) adjacency.set(node, [edge]);
    else list.push(edge);
  };
  for (const edge of edges) {
    attach(edge.fromNode, edge);
    if (edge.toNode !== edge.fromNode) attach(edge.toNode, edge);
  }
  return adjacency;
}
