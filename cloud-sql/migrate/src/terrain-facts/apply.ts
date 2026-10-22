import { createHash } from "node:crypto";
import { haversine, stableJson, steepestWindow, type Queryable } from "./packet";
import { KINDS, type Kind } from "../trail-graph/types";

/**
 * Turns a reviewed decision into segment kinds on one route.
 *
 * A decision lists intervals along the route, each with a kind. Segments
 * wholly inside an interval take its kind. A segment an interval ends inside
 * is split at that exact point, for every route that uses it. A scramble or
 * climb label the decision does not back goes back to trail: before sourced
 * review, those labels came from OSM sac_scale, and the import checked glacier
 * outlines first, so such a segment is not on mapped ice.
 *
 * Dry run plans; apply repeats the plan inside one transaction and refuses
 * to write if anything it read has changed.
 */

export type Endpoint = number | "start" | "end" | { elevation_ft: number; crossing: "first" | "last" } | { segment: string; edge: "start" | "end" };
/** `display_name` renames the stretch, e.g. a climbers' trail's last 160 ft as "Summit gully".
 *  Kind `hold` keeps whatever the segment is now and exempts it from the reset: evidence of
 *  hands that is below the scramble bar must never make a route read easier. */
export interface Interval { kind: Kind | "hold"; from: Endpoint; to: Endpoint; note: string; display_name?: string | null }
/** The reviewed line on what the whole trip needs, shown on the route. */
export interface TerrainSummary { line: string; gear: string[]; hardest_class: string | null; sources: { name: string; url: string }[] }
export interface Decision { route_id: string; packet_sha256: string; apply: Interval[]; summary?: TerrainSummary | null }
export interface SegmentRow { ordinal: number; direction: "forward" | "reverse"; id: string; kind: Kind; coords: number[][]; display_name?: string | null }

export interface KindOp { op: "kind"; segment_id: string; from: Kind; to: Kind; display_name: string | null; route_m: [number, number] }
export interface SplitOp { op: "split"; segment_id: string; coords_sha: string; cuts_m: number[]; pieces: { id: string; kind: Kind; display_name: string | null; length_m: number }[] }
export interface Plan { route_id: string; length_m: number; summary: TerrainSummary | null; holds: { add: string[]; clear: string[] };
  /** DEM slope prompts for a second look; they never change a label. */
  flags: string[]; intervals: { kind: Kind | "hold"; start_m: number; end_m: number; note: string; display_name: string | null }[]; ops: (KindOp | SplitOp)[]; shared_with: string[] }

const SNAP_M = 15;
/** From reviewed WA/CA segments (2026-10-21): trails reach 70-116% over 50 m, scrambles 42-250%. */
const SCRAMBLE_MIN_PCT = 25, TRAIL_LOOK_PCT = 90;
const RESETTABLE: Kind[] = ["scramble", "climb"];

export function lineLength(coords: number[][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Cuts a line at distances from its first vertex; elevation is interpolated with position. */
export function cutLine(coords: number[][], cuts: number[]): number[][][] {
  const out: number[][][] = [];
  let piece = [coords[0]], along = 0, next = 0;
  const sorted = [...cuts].sort((a, b) => a - b);
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], step = haversine(a, b);
    while (next < sorted.length && sorted[next] <= along + step) {
      const t = step > 0 ? (sorted[next] - along) / step : 0;
      const p = a.map((v, k) => v + (b[k] - v) * t);
      piece.push(p); out.push(piece); piece = [p]; next++;
    }
    piece.push(b); along += step;
  }
  out.push(piece);
  return out.map(p => p.filter((c, i) => i === 0 || haversine(p[i - 1], c) > 0.01));
}

export function elevationStats(coords: number[][]): { gain: number; loss: number } {
  let gain = 0, loss = 0;
  for (let i = 1; i < coords.length; i++) { const dz = (coords[i][2] ?? 0) - (coords[i - 1][2] ?? 0); if (dz > 0) gain += dz; else loss -= dz; }
  return { gain, loss };
}

/** The route's own line, built from its segments in walking order. */
function walk(rows: SegmentRow[]) {
  let at = 0;
  const parts = rows.map(r => {
    const coords = r.direction === "reverse" ? [...r.coords].reverse() : r.coords, len = lineLength(r.coords);
    const part = { row: r, start: at, end: at + len, len, coords };
    at += len;
    return part;
  });
  return { parts, total: at };
}

export function resolve(e: Endpoint, rows: SegmentRow[]): number {
  const { parts, total } = walk(rows);
  if (e === "start") return 0;
  if (e === "end") return total;
  if (typeof e === "object" && "segment" in e) {
    const p = parts.find(x => x.row.id === e.segment);
    if (!p) throw new Error(`segment ${e.segment} is not on the route`);
    return e.edge === "start" ? p.start : p.end;
  }
  if (typeof e === "number") { if (e < 0 || e > total + 1) throw new Error(`${e} m is off a ${Math.round(total)} m route`); return Math.min(e, total); }
  const target = e.elevation_ft / 3.28084, hits: number[] = [];
  for (const p of parts) {
    let d = p.start;
    for (let i = 1; i < p.coords.length; i++) {
      const a = p.coords[i - 1], b = p.coords[i], step = haversine(a, b), za = a[2], zb = b[2];
      // Either direction: a traverse's descent crosses heights too.
      if (Number.isFinite(za) && Number.isFinite(zb) && za !== zb && (za - target) * (zb - target) <= 0 && zb !== target)
        hits.push(d + step * (target - za) / (zb - za));
      d += step;
    }
  }
  if (!hits.length) throw new Error(`the route never crosses ${e.elevation_ft} ft`);
  return e.crossing === "first" ? hits[0] : hits[hits.length - 1];
}

/** `held` lists segments another review held: they keep their kind unless this decision labels them. */
export function plan(routeId: string, rows: SegmentRow[], decision: Decision, sharedWith: string[] = [], held: string[] = [], reviewedHard: Record<string, Kind> = {}, heldElsewhere: string[] = []): Plan {
  const crossFlags: string[] = [], heldOther = new Set(heldElsewhere);
  if (decision.route_id !== routeId) throw new Error("decision is for another route");
  const { parts, total } = walk(rows);
  const intervals = decision.apply.map(i => {
    if (i.kind !== "hold" && !(KINDS as readonly string[]).includes(i.kind)) throw new Error(`unknown kind ${i.kind}`);
    if (i.kind === "hold" && i.display_name) throw new Error("a hold keeps the segment as it is; it cannot rename it");
    const start = resolve(i.from, rows), end = resolve(i.to, rows);
    if (!(end > start)) throw new Error(`interval ${JSON.stringify(i)} is empty`);
    if (i.display_name != null && !i.display_name.trim()) throw new Error("display_name must not be blank");
    return { kind: i.kind, start_m: start, end_m: end, note: i.note, display_name: i.display_name?.trim() ?? null };
  }).sort((a, b) => a.start_m - b.start_m);
  for (let i = 1; i < intervals.length; i++) if (intervals[i].start_m < intervals[i - 1].end_m - 1) throw new Error("decision intervals overlap");
  const at = (m: number) => intervals.find(i => m >= i.start_m && m < i.end_m);
  // Round up: a span that touches hands-on or technical ground takes the hardest such label, even when
  // that ground is too short to split off (a 12 m summit pitch at the end of a 45 m connector).
  const HARD: Record<string, number> = { climb: 3, scramble: 2, climbers_route: 1 };
  const over = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    // A hard interval counts when it overlaps the span by at least SNAP_M, or lies wholly inside it (a short
    // summit pitch); a few metres of spill from a neighbouring placement must not relabel a whole segment.
    const hard = intervals.filter(i => HARD[i.kind] && (Math.min(hi, i.end_m) - Math.max(lo, i.start_m) >= SNAP_M
        || (i.start_m >= lo - 0.5 && i.end_m <= hi + 0.5 && i.end_m - i.start_m > 0.5)))
      .sort((x, y) => HARD[y.kind] - HARD[x.kind])[0];
    return hard ?? at((lo + hi) / 2);
  };
  // The hard label a span takes; a climbers route still leaves mapped glacier and snowfield as they are.
  const hardKind = (i: (typeof intervals)[number] | undefined, fallback: Kind): Kind | null =>
    !i || !HARD[i.kind] ? null : i.kind === "climbers_route" && (fallback === "glacier" || fallback === "snowfield") ? fallback : i.kind as Kind;
  const kindAt = (m: number, fallback: Kind): Kind => {
    const i = at(m);
    // A hold keeps the segment, except an unproven climb: climb needs a stated 5th-class rating,
    // so a held OSM climb reads as a scramble until a decision says otherwise.
    if (i?.kind === "hold") return fallback === "climb" ? "scramble" : fallback;
    // A climbers route is the ground between the ice; mapped glacier and snowfield stay.
    if (i?.kind === "climbers_route" && (fallback === "glacier" || fallback === "snowfield")) return fallback;
    return i?.kind ?? (RESETTABLE.includes(fallback) ? "trail" : fallback);
  };

  const decided = new Map<string, string | null>();
  const ops: Plan["ops"] = [], seen = new Set<string>(), heldBefore = new Set(held), add: string[] = [], clear: string[] = [];
  for (const p of parts) {
    // A loop or a stem walks a segment twice: fine when both passes give the same answer.
    if (seen.has(p.row.id)) {
      const mid2 = (p.start + p.end) / 2, again = at(mid2);
      const first = decided.get(p.row.id)!;
      const cutsHere = intervals.some(i => [i.start_m, i.end_m].some(m => m > p.start + SNAP_M && m < p.end - SNAP_M));
      if (cutsHere || (again?.kind ?? null) !== first) throw new Error(`segment ${p.row.id} appears twice on the route with different answers; split it by hand`);
      continue;
    }
    seen.add(p.row.id);
    decided.set(p.row.id, at((p.start + p.end) / 2)?.kind ?? null);
    // Route-order cut positions inside this segment, snapped away from its ends.
    const mid = (p.start + p.end) / 2, covering = over(p.start, p.end);
    if (covering?.kind === "hold") {
      if (!heldBefore.has(p.row.id)) add.push(p.row.id);
      if (p.row.kind === "climb") ops.push({ op: "kind", segment_id: p.row.id, from: "climb", to: "scramble", display_name: null, route_m: [Math.round(p.start), Math.round(p.end)] });
      continue;
    }
    if (heldBefore.has(p.row.id)) {
      // Held elsewhere: only an explicit label on this segment settles it.
      if (!covering) {
        if (p.row.kind === "climb") ops.push({ op: "kind", segment_id: p.row.id, from: "climb", to: "scramble", display_name: null, route_m: [Math.round(p.start), Math.round(p.end)] });
        continue;
      }
      if (heldOther.has(p.row.id) && !(covering && HARD[covering.kind])) {
        crossFlags.push(`kept another route's hold on ${p.row.id} (this decision says ${covering.kind})`);
        if (p.row.kind === "climb") ops.push({ op: "kind", segment_id: p.row.id, from: "climb", to: "scramble", display_name: null, route_m: [Math.round(p.start), Math.round(p.end)] });
        continue;
      }
      clear.push(p.row.id);
    }
    const cuts = intervals.flatMap(i => [i.start_m, i.end_m]).filter(m => m > p.start + SNAP_M && m < p.end - SNAP_M)
      .sort((x, y) => x - y).filter((m, k, all) => k === 0 || m - all[k - 1] > 1);
    if (!cuts.length) {
      let to = hardKind(covering, p.row.kind) ?? kindAt(mid, p.row.kind);
      const name = covering?.display_name ?? null;
      // Round up across routes: a shared segment never loses a harder label another route's review gave it.
      const elsewhere = reviewedHard[p.row.id];
      if (elsewhere && (HARD[to] ?? 0) < HARD[elsewhere]) { crossFlags.push(`kept ${elsewhere} on ${p.row.id} from another route's review (this decision says ${to})`); to = elsewhere; }
      if (to !== p.row.kind || (name && name !== p.row.display_name)) ops.push({ op: "kind", segment_id: p.row.id, from: p.row.kind, to, display_name: name, route_m: [Math.round(p.start), Math.round(p.end)] });
      continue;
    }
    // Cuts measured from the segment's first stored vertex.
    const local = cuts.map(m => p.row.direction === "reverse" ? p.end - m : m - p.start).sort((a, b) => a - b);
    const pieces = cutLine(p.row.coords, local), id = (k: number) => `${p.row.id}-t${createHash("sha256").update(`${p.row.id}:${local.map(Math.round).join(",")}`).digest("hex").slice(0, 6)}${k}`;
    let offset = 0;
    const planned = pieces.map((c, k) => {
      const len = lineLength(c), mid = offset + len / 2, from = offset; offset += len;
      const routeMid = p.row.direction === "reverse" ? p.end - mid : p.start + mid;
      const span = p.row.direction === "reverse" ? [p.end - offset, p.end - from] : [p.start + from, p.start + offset];
      const hard = over(span[0], span[1]);
      // A piece under a hold is registered as held under its new id.
      if (at(routeMid)?.kind === "hold") add.push(id(k));
      let kind = hardKind(hard, p.row.kind) ?? kindAt(routeMid, p.row.kind);
      const elsewhere = reviewedHard[p.row.id];
      if (elsewhere && (HARD[kind] ?? 0) < HARD[elsewhere]) { crossFlags.push(`kept ${elsewhere} on part of ${p.row.id} from another route's review (this decision says ${kind})`); kind = elsewhere; }
      return { id: id(k), kind, display_name: (hard && HARD[hard.kind] ? hard : at(routeMid))?.display_name ?? null, length_m: Math.round(len) };
    });
    // Pieces that would all read the same are not worth a split: relabel the segment whole.
    if (planned.every(x => x.kind === planned[0].kind && x.display_name === planned[0].display_name)) {
      const { kind: to, display_name: name } = planned[0];
      if (to !== p.row.kind || (name && name !== p.row.display_name)) ops.push({ op: "kind", segment_id: p.row.id, from: p.row.kind, to, display_name: name, route_m: [Math.round(p.start), Math.round(p.end)] });
      continue;
    }
    ops.push({ op: "split", segment_id: p.row.id, coords_sha: sha(p.row.coords), cuts_m: local.map(Math.round), pieces: planned });
  }
  // Slope prompts: a scramble on gentle ground is probably misplaced; trail on very steep ground deserves a look.
  const line = parts.flatMap((p, k) => (k ? p.coords.slice(1) : p.coords)), along = [0];
  for (let k = 1; k < line.length; k++) along.push(along[k - 1] + haversine(line[k - 1], line[k]));
  const flags: string[] = [...crossFlags];
  for (const i of intervals.filter(i => i.kind === "scramble")) {
    const s = steepestWindow(line, along, i.start_m, i.end_m);
    if (s && s.grade_pct < SCRAMBLE_MIN_PCT) flags.push(`scramble ${Math.round(i.start_m)}-${Math.round(i.end_m)} m is no steeper than ${s.grade_pct}% over 50 m: check placement`);
  }
  for (const op of ops) if (op.op === "kind" && op.to === "trail" && op.from !== "trail") {
    const s = steepestWindow(line, along, op.route_m[0], op.route_m[1]);
    if (s && s.grade_pct >= TRAIL_LOOK_PCT) flags.push(`${op.segment_id} becomes trail but reaches ${s.grade_pct}% over 50 m at ${s.at_m} m: second look`);
  }
  return { route_id: routeId, length_m: Math.round(total), summary: checkSummary(decision.summary), holds: { add, clear }, flags, intervals: intervals.map(i => ({ ...i, start_m: Math.round(i.start_m), end_m: Math.round(i.end_m) })), ops, shared_with: sharedWith };
}

export function checkSummary(s: TerrainSummary | null | undefined): TerrainSummary | null {
  if (!s) return null;
  if (typeof s.line !== "string" || !s.line.trim() || s.line.length > 160) throw new Error("summary.line must be 1-160 characters");
  if (!Array.isArray(s.gear) || s.gear.some(g => typeof g !== "string" || !g.trim())) throw new Error("summary.gear must be a list of words");
  if (!Array.isArray(s.sources) || !s.sources.length || s.sources.some(x => !x?.name?.trim() || !/^https:\/\//.test(x?.url ?? ""))) throw new Error("summary.sources needs a name and an https URL each");
  return { line: s.line.trim(), gear: s.gear.map(g => g.trim()), hardest_class: s.hardest_class ?? null, sources: s.sources.map(x => ({ name: x.name.trim(), url: x.url })) };
}

export const sha = (v: unknown) => createHash("sha256").update(stableJson(v)).digest("hex");

export async function loadRoute(db: Queryable, routeId: string): Promise<{ rows: SegmentRow[]; sharedWith: string[]; held: string[]; reviewedHard: Record<string, Kind>; heldElsewhere: string[] }> {
  const rows = (await db.query(`
    SELECT rs.ordinal, rs.direction, s.id, s.kind, s.display_name, ST_AsGeoJSON(s.path::geometry, 9) AS geojson
    FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
    WHERE rs.route_id = $1 ORDER BY rs.ordinal`, [routeId])).rows
    .map(r => ({ ordinal: Number(r.ordinal), direction: r.direction, id: r.id, kind: r.kind, display_name: r.display_name, coords: JSON.parse(r.geojson).coordinates }));
  if (!rows.length) throw new Error(`route ${routeId} has no segments`);
  const sharedWith = (await db.query(`
    SELECT DISTINCT rs.route_id FROM route_segments rs
    WHERE rs.segment_id = ANY($1) AND rs.route_id <> $2 ORDER BY 1`, [rows.map(r => r.id), routeId])).rows.map(r => r.route_id);
  const heldRows = (await db.query(`SELECT segment_id, route_id FROM segment_terrain_holds WHERE segment_id = ANY($1) ORDER BY 1`, [rows.map(r => r.id)])).rows;
  // A hold another route set is not this route's to clear: its pages may hold evidence ours lack.
  const held = heldRows.map(r => r.segment_id), heldElsewhere = heldRows.filter(r => r.route_id !== routeId).map(r => r.segment_id);
  // The latest reviewed label each shared segment got on another route, when that label is hands-on or technical.
  const reviewedHard: Record<string, Kind> = {};
  for (const r of (await db.query(`
    SELECT DISTINCT ON (segment_id) segment_id, kind FROM segment_terrain_labels
    WHERE segment_id = ANY($1) AND route_id <> $2 ORDER BY segment_id, applied_at DESC, id DESC`, [rows.map(r => r.id), routeId])).rows)
    if (["scramble", "climb", "climbers_route"].includes(r.kind)) reviewedHard[r.segment_id] = r.kind;
  return { rows, sharedWith, held, reviewedHard, heldElsewhere };
}

export interface Evidence { plan_sha256: string; reviewed_by: string; sources: string[]; hold_question?: string }

/** Writes a plan. The caller owns the transaction; this re-reads and refuses on any drift. */
export async function applyPlan(db: Queryable, p: Plan, evidence: Evidence): Promise<string[]> {
  await db.query("SET LOCAL peaks.defer_rematch = 'on'");
  await db.query("SET LOCAL lock_timeout = '10s'");
  const touched = new Set<string>([p.route_id]);
  const record = (segment: string, parent: string | null, from: Kind | null, kind: Kind) => db.query(
    `INSERT INTO segment_terrain_labels (segment_id, parent_segment_id, route_id, from_kind, kind, plan_sha256, reviewed_by, sources) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [segment, parent, p.route_id, from, kind, evidence.plan_sha256, evidence.reviewed_by, JSON.stringify(evidence.sources)]);
  for (const op of p.ops) {
    const current = (await db.query(`SELECT kind, ST_AsGeoJSON(path::geometry, 9) AS geojson FROM segments WHERE id = $1 FOR UPDATE`, [op.segment_id])).rows[0];
    if (!current) throw new Error(`segment ${op.segment_id} is gone`);
    for (const r of (await db.query(`SELECT DISTINCT route_id FROM route_segments WHERE segment_id = $1`, [op.segment_id])).rows) touched.add(r.route_id);
    if (op.op === "kind") {
      if (current.kind !== op.from) throw new Error(`segment ${op.segment_id} is ${current.kind}, planned from ${op.from}`);
      await db.query(`UPDATE segments SET kind = $2, display_name = coalesce($3, display_name), updated_at = now() WHERE id = $1`, [op.segment_id, op.to, op.display_name]);
      await record(op.segment_id, null, op.from, op.to);
      continue;
    }
    const coords: number[][] = JSON.parse(current.geojson).coordinates;
    if (sha(coords) !== op.coords_sha) throw new Error(`segment ${op.segment_id} geometry changed since the plan`);
    const pieces = cutLine(coords, op.cuts_m);
    if (pieces.length !== op.pieces.length) throw new Error(`segment ${op.segment_id} cut into ${pieces.length}, planned ${op.pieces.length}`);
    for (let k = 0; k < pieces.length; k++) {
      const c = pieces[k], { gain, loss } = elevationStats(c), wkt = `LINESTRING Z(${c.map(x => `${x[0]} ${x[1]} ${x[2] ?? 0}`).join(",")})`;
      await db.query(`
        INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss, provenance, trail_names, kind, display_name, description, description_source_url, state_code)
        SELECT $2, name, ST_GeomFromText($3, 4326)::geography, NULL, $4, $5, $6, provenance,
               trail_names, $7, coalesce($8, display_name), description, description_source_url, state_code
        FROM segments WHERE id = $1`,
        [op.segment_id, op.pieces[k].id, wkt, Math.round(lineLength(c)), Math.round(gain), Math.round(loss), op.pieces[k].kind, op.pieces[k].display_name]);
      await record(op.pieces[k].id, op.segment_id, current.kind, op.pieces[k].kind);
    }
    const ids = op.pieces.map(x => x.id);
    for (const link of (await db.query(`SELECT route_id, ordinal, direction FROM route_segments WHERE segment_id = $1 ORDER BY route_id, ordinal DESC`, [op.segment_id])).rows) {
      await db.query(`DELETE FROM route_segments WHERE route_id = $1 AND segment_id = $2 AND ordinal = $3`, [link.route_id, op.segment_id, link.ordinal]);
      await db.query(`UPDATE route_segments SET ordinal = ordinal + $3 WHERE route_id = $1 AND ordinal > $2`, [link.route_id, link.ordinal, ids.length - 1]);
      const ordered = link.direction === "reverse" ? [...ids].reverse() : ids;
      for (let j = 0; j < ordered.length; j++)
        await db.query(`INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, $3, $4)`, [link.route_id, ordered[j], Number(link.ordinal) + j, link.direction]);
    }
    await db.query(`DELETE FROM segments WHERE id = $1`, [op.segment_id]);
  }
  const routes = [...touched];
  if (p.ops.some(o => o.op === "split")) {
    const rebuilt = (await db.query(`SELECT rebuild_route_paths($1) AS r`, [routes])).rows[0].r as { route_id: string; success: boolean; error?: string }[];
    const failed = rebuilt.filter(r => !r.success);
    if (failed.length) throw new Error(`route path rebuild failed: ${JSON.stringify(failed)}`);
    await db.query(`SELECT refresh_route_derivations($1)`, [routes]);
    // Splitting drops the parent's session visits; queue those sessions to match again.
    await db.query(`SELECT queue_matching_routes($1, 'terrain split')`, [routes]);
  }
  for (const id of p.holds.add)
    await db.query(`INSERT INTO segment_terrain_holds (segment_id, route_id, question, plan_sha256) VALUES ($1, $2, $3, $4) ON CONFLICT (segment_id) DO NOTHING`,
      [id, p.route_id, evidence.hold_question ?? "held in terrain review", evidence.plan_sha256]);
  if (p.holds.clear.length) await db.query(`DELETE FROM segment_terrain_holds WHERE segment_id = ANY($1)`, [p.holds.clear]);
  // Kinds set the route's terrain category and its difficulty floor.
  await db.query(`SELECT refresh_route_terrain($1)`, [routes]);
  // After the refresh: the reviewed-route guard accepts a summary only beside the current category.
  if (p.summary) await db.query(`UPDATE routes SET terrain_summary = $2::jsonb WHERE id = $1`,
    [p.route_id, JSON.stringify({ ...p.summary, reviewed_at: new Date().toISOString().slice(0, 10) })]);
  return routes;
}
