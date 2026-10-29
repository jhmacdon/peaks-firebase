import proj4 from "proj4";

export type Outline = { type: "MultiPolygon"; coordinates: number[][][][] };
type Point = [number, number];
type Ring = Point[];
type Segment = { a: Point; b: Point; minX: number; maxX: number; minY: number; maxY: number; ring: number; index: number; count: number };
type Shape = { rings: Ring[]; segments: Segment[]; area: number };
export type Overlap = { intersection_km2: number; iou: number; osm_share: number; candidate_share: number };

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const signedArea = (r: Ring) => r.slice(1).reduce((sum, b, i) => sum + cross(r[i], b), 0) / 2;
const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
function contains(ring: Ring, p: Point): boolean {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const key = (p: Point) => `${p[0]},${p[1]}`;
/** Vertices of `ring` that are not vertices of any of `others`. Holes may
 * touch their exterior, and parts each other, at a shared vertex. Every such
 * vertex is tested, never one sample: a ring can leave another through two
 * shared vertices while its first free vertex still lies inside. */
function free(ring: Ring, ...others: Ring[]): Point[] {
  const shared = new Set(others.flatMap(r => r.map(key)));
  return ring.filter(p => !shared.has(key(p)));
}
/** OGC polygon rules for holes: each hole lies inside the exterior and
 * outside the other holes, and rings meet only at shared vertices that leave
 * the interior connected. Rings and their contact points form a graph; any
 * cycle (two rings meeting twice, or a chain of holes from the exterior back
 * to it) cuts the interior in two. Crossing edges fail the segment check. */
function checkHoles(polygon: Ring[]): void {
  const links = new Map<string, string>(), edges = new Set<string>();
  const root = (n: string): string => { while (links.has(n)) n = links.get(n)!; return n; };
  for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
    const a = polygon[i], b = polygon[j];
    if (i === 0) { if (free(b, a).some(p => !contains(a, p)) || !free(b, a).length) throw new Error("Orphan outline hole"); }
    else if (free(b, a).some(p => contains(a, p)) || free(a, b).some(p => contains(b, p))) throw new Error("Nested outline holes");
    const shared = new Set(a.map(key));
    for (const point of new Set(b.map(key).filter(k => shared.has(k)))) for (const ring of [i, j]) {
      const edge = `${ring}|${point}`;
      if (edges.has(edge)) continue;
      edges.add(edge);
      const x = root(`r${ring}`), y = root(`p${point}`);
      if (x === y) throw new Error("Outline rings touch so the interior splits");
      links.set(x, y);
    }
  }
}
function boxesTouch(a: Segment, b: Segment): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}
/** null, one contact's x, or a shared edge. Coordinates are local metres. */
function contact(a: Segment, b: Segment): number | "edge" | null {
  if (!boxesTouch(a, b)) return null;
  const r = minus(a.b, a.a), s = minus(b.b, b.a), q = minus(b.a, a.a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-10) {
    if (Math.abs(cross(q, r)) > 1e-7) return null;
    const axis = Math.abs(r[0]) > Math.abs(r[1]) ? 0 : 1;
    const lo = Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]));
    const hi = Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis]));
    return hi > lo + 1e-8 ? "edge" : hi >= lo ? (axis === 0 ? lo : a.a[0]) : null;
  }
  const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? a.a[0] + t * r[0] : null;
}
function intervals(shape: Shape, x: number): [number, number][] {
  const ys = shape.segments.filter(s => s.minX < x && s.maxX > x)
    .map(s => s.a[1] + (x - s.a[0]) * (s.b[1] - s.a[1]) / (s.b[0] - s.a[0])).sort((a, b) => a - b);
  if (ys.length % 2) throw new Error("Odd outline scanline; invalid polygon");
  const result: [number, number][] = [];
  for (let i = 0; i < ys.length; i += 2) result.push([ys[i], ys[i + 1]]);
  return result;
}
/** Integrate intersection length over x slabs. All segment endpoints and
 * crossings split slabs, so length is linear and the midpoint integral is
 * exact for the projected straight edges. Holes and parts use even/odd fill.
 * This computes area only; it never clips or changes source coordinates. */
function intersection(a: Shape, b: Shape): number {
  const events = [...a.segments, ...b.segments].flatMap(s => [s.minX, s.maxX]);
  for (const s of a.segments) for (const t of b.segments) {
    const c = contact(s, t);
    if (typeof c === "number") events.push(c);
  }
  const xs = [...new Set(events)].sort((x, y) => x - y);
  let area = 0;
  for (let k = 1; k < xs.length; k++) {
    const width = xs[k] - xs[k - 1], x = xs[k - 1] + width / 2;
    // A crossing computed within an ulp of a shared vertex leaves a slab
    // whose midpoint rounds onto an endpoint; it holds no area.
    if (!(x > xs[k - 1] && x < xs[k])) continue;
    const left = intervals(a, x), right = intervals(b, x);
    let i = 0, j = 0, height = 0;
    while (i < left.length && j < right.length) {
      height += Math.max(0, Math.min(left[i][1], right[j][1]) - Math.max(left[i][0], right[j][0]));
      if (left[i][1] < right[j][1]) i++; else j++;
    }
    area += height * width;
  }
  return area;
}

/** Decimal places kept for every computed metric (km² areas, overlap shares,
 * IoU, area ratios) that is compared, hashed or written. The projection calls
 * libm sin/cos/log, whose last digits differ between platforms (Linux vs
 * macOS), so unrounded metrics made manifest hashes platform-dependent.
 * 1e-9 km² is 0.001 m², and 1e-9 of a share is far below any decision margin.
 * Source coordinates and source attribute values are never rounded. */
export const METRIC_DECIMALS = 9;
export function stableMetric(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Non-finite outline metric");
  const rounded = Number(value.toFixed(METRIC_DECIMALS));
  return rounded === 0 ? 0 : rounded; // no -0 in JSON reviews
}
export const stableOverlap = (o: Overlap): Overlap => ({ intersection_km2: stableMetric(o.intersection_km2),
  iou: stableMetric(o.iou), osm_share: stableMetric(o.osm_share), candidate_share: stableMetric(o.candidate_share) });
export type OutlineMetrics = ReturnType<typeof rawOutlineMetrics>;
/** Rounds a metrics object's outputs; idempotent, so rounding twice is harmless. */
export const stabilizeMetrics = (m: OutlineMetrics): OutlineMetrics => ({ ...m,
  area: (outline: Outline) => stableMetric(m.area(outline)),
  overlap: (osm: Outline, candidate: Outline) => stableOverlap(m.overlap(osm, candidate)) });
/** Platform-stable metrics: use these for anything that reaches a review or manifest. */
export const outlineMetrics = (origin: { lng: number; lat: number }) => stabilizeMetrics(rawOutlineMetrics(origin));

/** One WGS84 ellipsoidal Lambert equal-area projection per mountain packet.
 * A local extent avoids dateline/polar ambiguity. PostGIS validates the
 * original WGS84 shapes again, including park coverage, before any DB write.
 * Outputs carry full libm precision; callers use `outlineMetrics`. */
export function rawOutlineMetrics(origin: { lng: number; lat: number }) {
  if (!Number.isFinite(origin.lng) || !Number.isFinite(origin.lat) || Math.abs(origin.lat) >= 89 || Math.abs(origin.lng) > 180)
    throw new Error("Invalid local outline projection origin");
  const crs = `+proj=laea +lat_0=${origin.lat} +lon_0=${origin.lng} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
  const projection = proj4("EPSG:4326", crs);
  const cache = new WeakMap<Outline, Shape>();
  function shape(outline: Outline): Shape {
    const existing = cache.get(outline);
    if (existing) return existing;
    if (outline?.type !== "MultiPolygon" || !Array.isArray(outline.coordinates) || !outline.coordinates.length)
      throw new Error("Outline must be a nonempty MultiPolygon");
    const rings: Ring[] = [], segments: Segment[] = [];
    let area = 0;
    for (const polygon of outline.coordinates) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error("Missing polygon exterior");
      const projected: Ring[] = polygon.map(ring => {
        if (!Array.isArray(ring) || ring.length < 4 || !same(ring[0], ring[ring.length - 1])) throw new Error("Open or short outline ring");
        const result = ring.map(p => {
          if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90
            || Math.abs(p[0] - origin.lng) > 3 || Math.abs(p[1] - origin.lat) > 3) throw new Error("Invalid/nonlocal WGS84 outline coordinate");
          const projected = projection.forward(p) as Point;
          if (!projected.every(Number.isFinite)) throw new Error("Outline projection failed");
          return projected;
        }).filter((p, i, all) => i === 0 || !same(p, all[i - 1]));
        // Redundant consecutive vertices are valid in OGC polygons. Ignore
        // zero-length edges for measurements, preserving the input bytes.
        if (result.length < 4) throw new Error("Degenerate outline ring");
        if (Math.abs(signedArea(result)) < 1e-4) throw new Error("Degenerate outline ring");
        const index = rings.length;
        for (let i = 1; i < result.length; i++) {
          const a = result[i - 1], b = result[i];
          segments.push({ a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
            minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]), ring: index, index: i - 1, count: result.length - 1 });
        }
        rings.push(result);
        return result;
      });
      area += Math.abs(signedArea(projected[0])) - projected.slice(1).reduce((sum, r) => sum + Math.abs(signedArea(r)), 0);
      checkHoles(projected);
    }
    if (!(area > 0)) throw new Error("Empty outline area");
    const sorted = segments.slice().sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].minX <= sorted[i].maxX; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.ring === b.ring && (Math.abs(a.index - b.index) === 1 || Math.abs(a.index - b.index) === a.count - 1)) continue;
      const c = contact(a, b);
      if (c !== null && (a.ring === b.ring || c === "edge" ||
        ![a.a, a.b].some(p => [b.a, b.b].some(q => same(p, q))))) throw new Error(`Self-intersection or crossing outline rings (${a.ring}:${a.index}, ${b.ring}:${b.index})`);
    }
    // A fully nested component has no boundary intersection, but is invalid
    // as a MultiPolygon too. Holes in the containing part remain outside.
    const projectedParts = outline.coordinates.map(p => p.map(r => r.map(v => projection.forward(v) as Point)));
    for (let i = 0; i < projectedParts.length; i++) for (let j = 0; j < projectedParts.length; j++) {
      if (i !== j && free(projectedParts[j][0], ...projectedParts[i]).some(point => contains(projectedParts[i][0], point) &&
        !projectedParts[i].slice(1).some(r => contains(r, point)))) throw new Error("Overlapping outline components");
    }
    const value = { rings, segments, area };
    cache.set(outline, value);
    return value;
  }
  return {
    crs,
    area: (outline: Outline) => shape(outline).area / 1e6,
    validate: (outline: Outline) => { shape(outline); },
    overlap: (osm: Outline, candidate: Outline): Overlap => {
      const a = shape(osm), b = shape(candidate), value = intersection(a, b);
      if (value < -1e-4 || value > Math.min(a.area, b.area) + 1e-3) throw new Error("Invalid outline intersection area");
      const common = Math.max(0, Math.min(value, a.area, b.area));
      return { intersection_km2: common / 1e6, iou: common / (a.area + b.area - common), osm_share: common / a.area, candidate_share: common / b.area };
    },
  };
}
