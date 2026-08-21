// Seeded topographic-contour geometry — the hero art on the landing page,
// reused by the SEO landing pages (plan Task 18).
//
// Pure and deterministic: a given seed always yields the same paths, so the
// server render and the client hydrate match, and a rebuild never reshuffles
// the hero. Nothing here calls Math.random.
//
// Shape model. Every ring shares one angular deformation field — a handful
// of sine harmonics with seeded phases and amplitudes — so the rings run
// roughly parallel the way real contour lines do, instead of reading as a
// stack of unrelated blobs. Three things vary with the ring index:
//   - radius, on a mild power curve (contours crowd toward the summit);
//   - deformation, growing outward (summit rings are round, lower ones ragged);
//   - center, drifting along one seeded bearing (the peak leans off-axis).
// The defaults are picked so no ring crosses its neighbour and every point
// stays inside the viewBox — see contour-rings.test.ts, which asserts both.

const TAU = Math.PI * 2;

/** Angular frequencies of the shared deformation field. Below 2 a harmonic
 * just shifts the whole ring off-center (already handled by the drift), and
 * above 9 the wobble is smaller than the stroke. The low orders read as
 * ridges and the high ones as gullies. */
const HARMONIC_ORDERS = [2, 3, 4, 5, 6, 7, 9];

/** How far the innermost ring's center travels to reach the outermost, in
 * user units along one seeded bearing. */
const CENTER_DRIFT = 30;

export interface ContourRing {
  /** Closed SVG path data ("M … C … Z"), coordinates in viewBox units. */
  d: string;
  /** Polyline length of the sampled points — an approximation of the curve,
   * for stroke-dash draw-in. Slightly short; callers overshoot. */
  length: number;
  /** Center this ring was drawn around (the summit dot sits here). */
  cx: number;
  cy: number;
  /** Undeformed radius. */
  radius: number;
}

export interface ContourField {
  /** The field is square: viewBox is `0 0 size size`. */
  size: number;
  /** Innermost (summit) ring first. */
  rings: ContourRing[];
}

export interface ContourFieldOptions {
  seed?: number;
  size?: number;
  ringCount?: number;
  innerRadius?: number;
  outerRadius?: number;
  /** Points sampled per ring before curve smoothing. */
  samples?: number;
  /** Peak radial deformation of the outermost ring, as a fraction of its
   * radius. */
  roughness?: number;
}

interface Point {
  x: number;
  y: number;
}

/** mulberry32 — a small, fast, well-distributed seeded generator. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Catmull-Rom through every sampled point, converted to cubic Beziers and
 * closed. Smooth by construction and it passes through the points, so the
 * ring keeps the radius the field asked for. */
function closedCurvePath(points: Point[]): string {
  const count = points.length;
  const at = (index: number): Point => points[((index % count) + count) % count];

  const parts = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let i = 0; i < count; i++) {
    const previous = at(i - 1);
    const start = at(i);
    const end = at(i + 1);
    const next = at(i + 2);
    const c1x = start.x + (end.x - previous.x) / 6;
    const c1y = start.y + (end.y - previous.y) / 6;
    const c2x = end.x - (next.x - start.x) / 6;
    const c2y = end.y - (next.y - start.y) / 6;
    parts.push(
      `C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(end.x)} ${round(end.y)}`
    );
  }
  parts.push("Z");
  return parts.join(" ");
}

function closedPolylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

export function generateContourField(
  options: ContourFieldOptions = {}
): ContourField {
  const {
    seed = 1,
    size = 600,
    ringCount = 8,
    innerRadius = 44,
    outerRadius = 224,
    samples = 72,
    roughness = 0.17,
  } = options;

  if (ringCount < 1 || samples < 3) {
    return { size, rings: [] };
  }

  const random = createRandom(seed);

  const rawHarmonics = HARMONIC_ORDERS.map((order) => ({
    order,
    amplitude: (0.55 + 0.9 * random()) / order,
    phase: random() * TAU,
    // Rotates each harmonic a little from one ring to the next, so the
    // rings are near-parallel rather than perfectly concentric copies.
    drift: (random() - 0.5) * 0.7,
  }));
  const amplitudeSum = rawHarmonics.reduce((total, h) => total + h.amplitude, 0);
  // Normalized so the field lands in [-1, 1] and `roughness` means what it says.
  const harmonics = rawHarmonics.map((h) => ({
    ...h,
    amplitude: h.amplitude / amplitudeSum,
  }));

  const driftBearing = random() * TAU;
  const driftX = Math.cos(driftBearing) * CENTER_DRIFT;
  const driftY = Math.sin(driftBearing) * CENTER_DRIFT;

  const rings: ContourRing[] = [];
  for (let index = 0; index < ringCount; index++) {
    const t = ringCount === 1 ? 0 : index / (ringCount - 1);
    const radius = innerRadius + (outerRadius - innerRadius) * Math.pow(t, 1.15);
    const deformation = roughness * (0.35 + 0.65 * t);
    const drift = Math.pow(t, 1.3);
    const cx = size / 2 + driftX * drift;
    const cy = size / 2 + driftY * drift;

    const points: Point[] = [];
    for (let step = 0; step < samples; step++) {
      const angle = (step / samples) * TAU;
      let offset = 0;
      for (const harmonic of harmonics) {
        offset +=
          harmonic.amplitude *
          Math.sin(harmonic.order * angle + harmonic.phase + index * harmonic.drift);
      }
      const r = radius * (1 + deformation * offset);
      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }

    rings.push({
      d: closedCurvePath(points),
      length: closedPolylineLength(points),
      cx: round(cx),
      cy: round(cy),
      radius,
    });
  }

  return { size, rings };
}

/** Every coordinate in a path, in the order it appears. Path data here is
 * always an alternating x/y stream ("M x y", "C x y x y x y"), so callers can
 * read even indices as x and odd as y. Exported for tests. */
export function pathCoordinates(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}
