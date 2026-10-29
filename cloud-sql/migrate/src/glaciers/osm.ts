import { staleGlacierOutlines, staleOutline, type StaleOutline } from "./stale-outlines";
import { canonicalOsmId, deterministicLakeDestinationId, extractOsmLakeLinework, osmIdentityKey, osmExternalIdField, type OverpassElement } from "../osm-lake-coverage";

/** Shared OSM natural=glacier parser for every mountain builder. */
export type Position = [number, number];
export type Polygon = Position[][];
export interface GlacierCandidate {
  id: string; name: string; osm_key: string; external_ids: Record<string, string>;
  kind: "glacier" | "snowfield";
  boundary: { type: "MultiPolygon"; coordinates: Polygon[] };
}
export type OsmGlacierOptions = {
  /** OSM names to mark kind=snowfield; everything else is a glacier. */
  snowfields?: Iterable<string>;
  /** When set, keep exactly these `osm_key`s and fail if any is missing. */
  roster?: Iterable<string>;
  /** Outlines that are not current glaciers; defaults to data/stale-glacier-outlines.json. */
  stale?: Map<string, StaleOutline>;
};

const equal = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
function ringArea(r: Position[]): number {
  return r.slice(1).reduce((v, p, i) => v + r[i][0] * p[1] - p[0] * r[i][1], 0) / 2;
}
function contains(r: Position[], p: Position): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Every vertex of `hole` that is not a node of `outer` lies inside it, and
 * one such vertex exists. A hole may touch its outer ring at a shared node
 * (valid OGC geometry); outline validation rejects contacts that split it. */
function within(outer: Position[], hole: Position[]): boolean {
  const shared = new Set(outer.map(p => `${p[0]},${p[1]}`));
  const free = hole.filter(p => !shared.has(`${p[0]},${p[1]}`));
  return free.length > 0 && free.every(p => contains(outer, p));
}
/** Stitch by shared OSM endpoints. Never close an incomplete ring or discard a member. */
function rings(lines: Position[][]): Position[][] {
  const pending = lines.map(l => l.slice());
  const result: Position[][] = [];
  while (pending.length) {
    let ring = pending.shift()!;
    while (!equal(ring[0], ring[ring.length - 1])) {
      const matches = pending.flatMap((line, i) => equal(ring[ring.length - 1], line[0])
        ? [{ i, reverse: false }] : equal(ring[ring.length - 1], line[line.length - 1]) ? [{ i, reverse: true }] : []);
      if (matches.length !== 1) throw new Error("Open or ambiguous OSM ring");
      const { i, reverse } = matches[0];
      let next = pending.splice(i, 1)[0];
      if (reverse) next = next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length < 4 || Math.abs(ringArea(ring)) < 1e-14) throw new Error("Degenerate OSM ring");
    result.push(ring);
  }
  return result;
}
function linework(element: OverpassElement): Polygon[] {
  const read = (e: OverpassElement): Position[][] => {
    if (!Array.isArray(e.geometry) || e.geometry.some(p => !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon ?? p.lng) || Math.abs(p.lat)>90 || Math.abs((p.lon ?? p.lng)!)>180))
      throw new Error("Invalid WGS84 member geometry");
    const lines = extractOsmLakeLinework(e)?.coordinates;
    if (!lines?.length) throw new Error(`Missing geometry: ${element.id}`);
    for (const line of lines) for (const [lng, lat] of line) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)
        throw new Error("Invalid WGS84 position");
    }
    return lines;
  };
  if (element.type === "way") return rings(read(element)).map(r => [r]);
  if (!element.members?.length) throw new Error("Multipolygon has no members");
  const outer: Position[][] = [], inner: Position[][] = [];
  for (const m of element.members) {
    if (m.type !== "way" || !["", "outer", "inner"].includes(m.role ?? "")) throw new Error("Unsupported multipolygon member");
    if (!m.geometry || m.geometry.length < 2) throw new Error("Incomplete multipolygon member");
    const lines = read({ type: "way", id: m.ref!, geometry: m.geometry });
    (m.role === "inner" ? inner : outer).push(...lines);
  }
  const polygons = rings(outer).map(r => [r]);
  if (!polygons.length) throw new Error("Multipolygon has no outer rings");
  for (const hole of rings(inner)) {
    const parent = polygons.filter(p => within(p[0], hole)).sort((a, b) => Math.abs(ringArea(a[0])) - Math.abs(ringArea(b[0])))[0];
    if (!parent) throw new Error("Orphan multipolygon hole");
    parent.push(hole);
  }
  return polygons;
}

/** Same type-qualified identities and parent-member deduplication as the lake importer. */
export function parseOsmGlaciers(snapshot: unknown, options: OsmGlacierOptions = {}): GlacierCandidate[] {
  const snowfields = new Set(options.snowfields ?? []);
  const roster = options.roster ? new Set(options.roster) : null;
  const stale = options.stale ?? staleGlacierOutlines();
  for (const key of roster ?? []) {
    const listed = staleOutline(key, stale);
    if (listed) throw new Error(`Roster lists ${key} (${listed.name}), which data/stale-glacier-outlines.json marks ${listed.status}`);
  }
  const response = snapshot as { elements?: OverpassElement[]; remark?: string };
  if (!response || response.remark || !Array.isArray(response.elements)) throw new Error("Incomplete Overpass snapshot");
  const named = response.elements.filter(e => e.tags?.natural === "glacier" && e.tags.name?.trim());
  const memberWays = new Set(named.filter(e => e.type === "relation").flatMap(e =>
    (e.members ?? []).filter(m => m.type === "way").map(m => canonicalOsmId(m.ref))));
  const seen = new Set<string>();
  // A gone or remnant outline, or a member way of one, never becomes a glacier place.
  const places = named.filter(e => (e.type !== "way" || !memberWays.has(canonicalOsmId(e.id))) && !staleOutline(`${e.type}/${e.id}`, stale)).map(e => {
    if (e.type !== "way" && e.type !== "relation") throw new Error("Named glacier has no polygon");
    const key = osmIdentityKey(e.type, e.id);
    if (seen.has(key)) throw new Error(`Duplicate OSM identity ${key}`);
    seen.add(key);
    const external_ids: Record<string, string> = { [osmExternalIdField(e.type)]: canonicalOsmId(e.id)! };
    if (e.tags?.wikidata) {
      if (!/^Q[1-9][0-9]*$/.test(e.tags.wikidata)) throw new Error("Invalid Wikidata id");
      external_ids.wikidata = e.tags.wikidata;
    }
    return { id: deterministicLakeDestinationId(e.type, e.id), name: e.tags!.name.trim(), osm_key: key,
      kind: snowfields.has(e.tags!.name.trim()) ? "snowfield" : "glacier",
      external_ids, boundary: { type: "MultiPolygon", coordinates: linework(e) } } satisfies GlacierCandidate;
  });
  if (!roster) return places;
  const kept = places.filter(p => roster.has(p.osm_key));
  const missing = [...roster].filter(k => !kept.some(p => p.osm_key === k));
  if (missing.length) throw new Error(`Roster OSM elements missing from snapshot: ${missing.join(", ")}`);
  return kept;
}
