import { createHash } from "node:crypto";

/**
 * The research packet: what one route is, in the order a hiker walks it.
 *
 * It names stretches and waypoints so a researcher can place a fact without
 * inventing coordinates. It leaves out each segment's current `kind` and the
 * OSM difficulty tags: those are the guesses this pipeline replaces, and
 * showing them would anchor the research.
 */

export type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export interface Stretch { id: string; name: string | null; segment_ids: string[]; start_m: number; end_m: number; start_ft: number | null; end_ft: number | null; low_ft: number | null; high_ft: number | null;
  /** Steepest 50 m on the DEM, as a grade, and where it starts. A hint for where hands might be, never proof. */
  steepest_50m?: { grade_pct: number; at_m: number } | null }
export interface Waypoint { id: string; destination_id: string; name: string; features: string[]; along_m: number; elevation_ft: number | null; off_route_m: number }
export interface Packet {
  route_id: string; route_name: string; shape: string | null; state_code: string | null;
  objective: { destination_id: string; name: string; elevation_ft: number | null } | null;
  trailhead: { destination_id: string; name: string } | null;
  length_m: number; low_ft: number | null; high_ft: number | null;
  stretches: Stretch[]; waypoints: Waypoint[];
  /** [metres along the route, feet] every 100 m and at the end. */
  profile: [number, number | null][];
  built_at: string;
}

const FT = 3.28084;
const ft = (m: number | null | undefined) => m == null || !Number.isFinite(m) ? null : Math.round(m * FT);

export function haversine([x1, y1]: number[], [x2, y2]: number[]): number {
  const r = Math.PI / 180, a = Math.sin((y2 - y1) * r / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin((x2 - x1) * r / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

/** Cumulative distance for each vertex of an [lng, lat, z] line. */
export function measure(coords: number[][]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  return out;
}

export function elevationAt(coords: number[][], along: number[], at: number): number | null {
  if (!coords.length) return null;
  let i = along.findIndex(d => d >= at);
  if (i <= 0) return i === 0 ? coords[0][2] ?? null : coords[coords.length - 1][2] ?? null;
  const [a, b] = [coords[i - 1][2], coords[i][2]];
  if (a == null || b == null) return a ?? b ?? null;
  const span = along[i] - along[i - 1];
  return span > 0 ? a + (b - a) * (at - along[i - 1]) / span : b;
}

/** Joins consecutive segments that share a display name into one stretch. */
export function groupStretches(segments: { id: string; name: string | null; length_m: number }[], coords: number[][], along: number[]): Stretch[] {
  const out: Stretch[] = [];
  let at = 0;
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.name === s.name) { last.segment_ids.push(s.id); last.end_m = at + s.length_m; }
    else out.push({ id: "", name: s.name, segment_ids: [s.id], start_m: at, end_m: at + s.length_m, start_ft: null, end_ft: null, low_ft: null, high_ft: null });
    at += s.length_m;
  }
  // Segment lengths and the route line are measured separately; scale to the line.
  const scale = at > 0 && along.length ? along[along.length - 1] / at : 1;
  return out.map((s, i) => {
    const start = s.start_m * scale, end = s.end_m * scale;
    const inside = coords.filter((_, k) => along[k] >= start && along[k] <= end).map(c => c[2]).filter((z): z is number => Number.isFinite(z));
    return { ...s, id: `S${i + 1}`, start_m: Math.round(start), end_m: Math.round(end),
      start_ft: ft(elevationAt(coords, along, start)), end_ft: ft(elevationAt(coords, along, end)),
      low_ft: inside.length ? ft(Math.min(...inside)) : null, high_ft: inside.length ? ft(Math.max(...inside)) : null,
      steepest_50m: steepestWindow(coords, along, start, end) };
  });
}

/** Steepest window of `window` metres between two route distances, from the line's own elevations. */
export function steepestWindow(coords: number[][], along: number[], from: number, to: number, window = 50): { grade_pct: number; at_m: number } | null {
  const idx = along.map((d, i) => i).filter(i => along[i] >= from && along[i] <= to);
  if (idx.length < 2 || to - from < window * 0.8) return null;
  let best: { grade_pct: number; at_m: number } | null = null, j = idx[0];
  for (const i of idx) {
    while (j < idx[idx.length - 1] && along[j] - along[i] < window) j++;
    const run = along[j] - along[i], zi = coords[i][2], zj = coords[j][2];
    if (run >= window * 0.8 && Number.isFinite(zi) && Number.isFinite(zj)) {
      const g = Math.abs(zj - zi) / run * 100;
      if (!best || g > best.grade_pct) best = { grade_pct: Math.round(g), at_m: Math.round(along[i]) };
    }
  }
  return best;
}

export function profile(coords: number[][], along: number[], every = 100): [number, number | null][] {
  const total = along[along.length - 1] ?? 0, out: [number, number | null][] = [];
  for (let d = 0; d < total; d += every) out.push([Math.round(d), ft(elevationAt(coords, along, d))]);
  out.push([Math.round(total), ft(elevationAt(coords, along, total))]);
  return out;
}

export async function buildPacket(db: Queryable, routeId: string, now = new Date()): Promise<Packet> {
  const route = (await db.query(`
    SELECT r.id, r.name, r.shape::text AS shape, r.state_code, ST_AsGeoJSON(r.path::geometry) AS path,
           o.id AS objective_id, o.name AS objective_name, o.elevation AS objective_elevation,
           t.id AS trailhead_id, t.name AS trailhead_name
    FROM routes r
    LEFT JOIN destinations o ON o.id = r.objective_destination_id
    LEFT JOIN destinations t ON t.id = r.trailhead_destination_id
    WHERE r.id = $1 AND r.status = 'active' AND r.owner = 'peaks'`, [routeId])).rows[0];
  if (!route) throw new Error(`no active Peaks route ${routeId}`);
  const coords: number[][] = JSON.parse(route.path).coordinates;
  if (coords.length < 2) throw new Error(`route ${routeId} has no path`);
  const along = measure(coords);

  const segments = (await db.query(`
    SELECT s.id, s.display_name AS name, ST_Length(s.path) AS length_m
    FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
    WHERE rs.route_id = $1 ORDER BY rs.ordinal`, [routeId])).rows.map(r => ({ id: r.id, name: r.name, length_m: Number(r.length_m) }));
  if (!segments.length) throw new Error(`route ${routeId} has no segments`);

  // Named places on or near the line. The line goes in as a constant so the
  // destinations location index can answer the 75 m search on a small database.
  const line = JSON.stringify({ type: "LineString", coordinates: coords.map(c => [c[0], c[1]]) });
  const places = (await db.query(`
    WITH g AS (SELECT ST_GeomFromGeoJSON($2)::geography AS line),
    near AS (
      SELECT d.id FROM destinations d, g WHERE d.owner = 'peaks' AND d.name IS NOT NULL AND ST_DWithin(d.location, g.line, 75)
      UNION SELECT destination_id FROM route_destinations WHERE route_id = $1)
    SELECT d.id, d.name, d.features::text[] AS features, d.elevation,
           ST_LineLocatePoint(g.line::geometry, d.location::geometry) AS fraction,
           ST_Distance(d.location, g.line) AS off_route_m
    FROM near JOIN destinations d ON d.id = near.id, g
    WHERE d.name IS NOT NULL`, [routeId, line])).rows;
  const total = along[along.length - 1];
  const waypoints = places
    .map(p => ({ destination_id: p.id, name: p.name, features: p.features ?? [], along_m: Math.round(Number(p.fraction) * total), elevation_ft: ft(p.elevation), off_route_m: Math.round(Number(p.off_route_m)) }))
    .filter(p => p.off_route_m <= 250)
    .sort((a, b) => a.along_m - b.along_m || a.name.localeCompare(b.name))
    .map((p, i) => ({ id: `W${i + 1}`, ...p }));

  const zs = coords.map(c => c[2]).filter((z): z is number => Number.isFinite(z));
  return {
    route_id: route.id, route_name: route.name, shape: route.shape, state_code: route.state_code,
    objective: route.objective_id ? { destination_id: route.objective_id, name: route.objective_name, elevation_ft: ft(route.objective_elevation) } : null,
    trailhead: route.trailhead_id ? { destination_id: route.trailhead_id, name: route.trailhead_name } : null,
    length_m: Math.round(total), low_ft: zs.length ? ft(Math.min(...zs)) : null, high_ft: zs.length ? ft(Math.max(...zs)) : null,
    stretches: groupStretches(segments, coords, along), waypoints, profile: profile(coords, along), built_at: now.toISOString(),
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as any)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The hash a research result must echo. `built_at` is left out so a rebuild of the same route matches. */
export function packetSha256(packet: Packet): string {
  const { built_at: _, ...identity } = packet;
  return createHash("sha256").update(stableJson(identity)).digest("hex");
}
