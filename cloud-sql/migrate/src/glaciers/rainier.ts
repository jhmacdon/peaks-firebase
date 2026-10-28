import { createHash } from "node:crypto";
import { canonicalOsmId, deterministicLakeDestinationId, extractOsmLakeLinework, osmIdentityKey, osmExternalIdField, type OverpassElement } from "../osm-lake-coverage";

export const SNAPSHOT_SHA256 = "02cea8bc617563b180036921c7114b56e0234c359a0af174cf24becc37cf5cb0";
export const GEOMETRY_CREDIT = "© OpenStreetMap contributors";
export const FACTS_CREDIT = "Beason et al. (2023), National Park Service";
export const REPORT_URL = "https://doi.org/10.36967/2299328";
export const SNAPSHOT_DATE = "2026-10-28";
export type Position = [number, number];
export type Polygon = Position[][];
export interface GlacierCandidate {
  id: string; name: string; osm_key: string; external_ids: Record<string, string>;
  kind: "glacier" | "snowfield";
  boundary: { type: "MultiPolygon"; coordinates: Polygon[] };
}
export interface Observation { year: number; area_km2: number | null; uncertainty_km2: number | null }
export interface GlacierFacts {
  inventory_name: string | null; kind: "glacier" | "snowfield"; observed_year: number | null;
  area_km2: number | null; area_uncertainty_km2: number | null; rank_on_mountain: number | null;
  head_elevation_m: number | null; terminus_elevation_m: number | null; elevation_range_m: number | null;
  length_km: number | null; average_slope_deg: number | null;
  flow_direction_deg: number | null; flow_direction_label: string | null;
  type_code: string | null; type_label: string | null;
  estimated_volume_km3: number | null; volume_uncertainty_km3: number | null;
  area_history: Observation[]; area_history_scope: string | null; percent_change_since_earliest: number | null;
  description: string | null; description_source_url: string | null;
  provenance: Record<string, unknown>;
}

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
    const parent = polygons.filter(p => contains(p[0], hole[0])).sort((a, b) => Math.abs(ringArea(a[0])) - Math.abs(ringArea(b[0])))[0];
    if (!parent) throw new Error("Orphan multipolygon hole");
    parent.push(hole);
  }
  return polygons;
}

/** Same type-qualified identities and parent-member deduplication as the lake importer. */
export function parseGlaciers(snapshot: unknown): GlacierCandidate[] {
  const response = snapshot as { elements?: OverpassElement[]; remark?: string };
  if (!response || response.remark || !Array.isArray(response.elements)) throw new Error("Incomplete Overpass snapshot");
  const named = response.elements.filter(e => e.tags?.natural === "glacier" && e.tags.name?.trim());
  const memberWays = new Set(named.filter(e => e.type === "relation").flatMap(e =>
    (e.members ?? []).filter(m => m.type === "way").map(m => canonicalOsmId(m.ref))));
  const seen = new Set<string>();
  return named.filter(e => e.type !== "way" || !memberWays.has(canonicalOsmId(e.id))).map(e => {
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
      kind: e.tags!.name === "Muir Snowfield" ? "snowfield" : "glacier",
      external_ids, boundary: { type: "MultiPolygon", coordinates: linework(e) } };
  });
}

const number = (s: string): number => {
  const value=Number(s.replace(/,/g,""));
  if (!Number.isFinite(value)) throw new Error(`Invalid report number: ${s}`);
  return value;
};
function table(text: string, start: string, end: string): string[] {
  const from = text.indexOf(`\f${start}`);
  const to = text.indexOf(`\f${end}`, from + 1);
  if (from < 0 || to < 0) throw new Error(`Missing report table ${start}`);
  return text.slice(from, to).split(/\r?\n/);
}
const reportNames: Record<string, string | null> = {
  "Inter Glacier": "Inter", "Pyramid Glaciers": "Pyramid", "Sarvant Glacier": "Sarvent",
  "Muir Snowfield": null, "Pinnacle Glacier": null,
};
const historyNames: Record<string, string> = { Cowlitz: "Cowlitz-Ingraham", Ingraham: "Cowlitz-Ingraham",
  Kautz: "Kautz-Success", Success: "Kautz-Success", Nisqually: "Nisqually-Wilson", Wilson: "Nisqually-Wilson",
  Paradise: "Paradise-Stevens" };
const copies: Record<string, string> = {
  Carbon: "Carbon Glacier lies on Mount Rainier’s north side. Its low terminus and thick ice reflect the shade of the surrounding valley walls and the snow that feeds it.",
  "Columbia Crest": "Columbia Crest Glacier occupies the summit crater of Mount Rainier. The name Columbia Crest dates to climbing parties in the late nineteenth century.",
  Emmons: "Emmons Glacier descends from Mount Rainier’s northeast side into the White River Valley. Rock debris from a 1963 rockfall off Little Tahoma covers much of its lower surface.",
  Kautz: "Kautz Glacier lies west of Nisqually Glacier on Mount Rainier’s southwest flank. Water released from beneath it has caused major debris flows, including events in 1947 and 2001.",
  Nisqually: "Nisqually Glacier lies above Paradise on Mount Rainier’s southwest side. Photographs and surveys have documented its advances and retreats since the nineteenth century.",
  "North Mowich": "North Mowich Glacier lies on Mount Rainier’s northwest side and feeds the North Mowich River. Ptarmigan Ridge separates it from the Flett and Russell glaciers to the northeast.",
  Puyallup: "Puyallup Glacier begins in Sunset Amphitheater on Mount Rainier’s west side. It ends in a hanging valley above the North Puyallup River.",
  Winthrop: "Winthrop Glacier lies on Mount Rainier’s northeast side. Rock debris covers its terminus, while ice breaking over bedrock forms domes and crevasses higher on the glacier.",
};

/** Parse published tables, not OCR guesses or point elevations from Wikidata. */
export function parseRainierFacts(report: string, candidates: GlacierCandidate[], pages: Record<string, string>): Record<string, GlacierFacts> {
  const areas = new Map<string, RegExpMatchArray>();
  for (const line of table(report, "Table 4.", "Glacier extent")) {
    const m = line.match(/^(.+?)\s{2,}([A-Z]{3})\s+(\d+)\s+([\d,]+)\s+±\s+([\d,]+)/);
    if (m) areas.set(m[1].trim(), m);
  }
  const topo = new Map<string, string[]>();
  for (const line of table(report, "Table 5.", "Table 6.")) {
    const m = line.match(/^([A-Za-z ]+?)\s{2,}(\d[\d,]*\s+.+)$/);
    if (m && areas.has(m[1].trim())) {
      const values = m[2].trim().split(/\s+/);
      if (values.length !== 11) throw new Error(`Unexpected Table 5 row: ${m[1]}`);
      topo.set(m[1].trim(), values);
    }
  }
  const history = new Map<string, Observation[]>();
  for (const line of table(report, "Table 7.", "Table 8.")) {
    const m = line.match(/^([A-Za-z -]+?)\s{2,}(.*±.*)$/);
    if (!m) continue;
    const cells = [...m[2].matchAll(/(\d+\.\d+)\s+±\s+(\d+\.\d+)|–/g)];
    if (cells.length !== 7) throw new Error(`Unexpected Table 7 row: ${m[1]}`);
    history.set(m[1].trim(), cells.map((v, i) => ({ year: [1896,1913,1971,1994,2009,2015,2021][i],
      area_km2: v[1] ? number(v[1]) : null, uncertainty_km2: v[2] ? number(v[2]) : null })));
  }
  const volumes = new Map<string, RegExpMatchArray>();
  const volumeStart = report.indexOf("\nTable 12. Estimated", report.indexOf("\fTable 7."));
  const volumeEnd = report.indexOf("\n5.7. Glacial Volume Change", volumeStart);
  if (volumeStart < 0 || volumeEnd < 0) throw new Error("Missing Table 12");
  for (const line of report.slice(volumeStart, volumeEnd).split(/\r?\n/)) {
    const m = line.match(/^(.+?)\s{2,}([A-Z]{3})\s+(\d+)\s+([\d,]+)\s+±\s+([\d,]+)/);
    if (m) volumes.set(m[2], m);
  }
  if (areas.size !== 28 || topo.size !== 28 || volumes.size !== 28 || history.size !== 25)
    throw new Error(`Incomplete report: area=${areas.size}, topography=${topo.size}, volume=${volumes.size}, history=${history.size}`);
  const result: Record<string, GlacierFacts> = {};
  for (const c of candidates) {
    const name = Object.prototype.hasOwnProperty.call(reportNames, c.name) ? reportNames[c.name] : c.name.replace(/ Glacier$/, "");
    const a = name ? areas.get(name) : undefined, t = name ? topo.get(name) : undefined;
    const v = a ? volumes.get(a[2]) : undefined;
    const scope = name ? historyNames[name] ?? name : null;
    const h = (scope ? history.get(scope) : undefined) ?? [];
    const known = h.filter(o => o.area_km2 !== null);
    const pageKey = name?.toLowerCase().replace(/ /g, "-");
    const page = pageKey ? pages[pageKey] : undefined;
    const type = page?.match(/Glacier Type:\s*([A-Z])\s*-\s*(.*?)\s*Mount Rainier National Park/);
    const description = name && page && page.includes(`${name} Glacier`) ? copies[name] ?? null : null;
    const pageUrl = pageKey && description ? `https://www.nps.gov/places/${pageKey}-glacier.htm` : null;
    result[c.name] = {
      inventory_name: name, kind: c.kind, observed_year: a ? 2021 : null,
      area_km2: a ? number(a[4]) / 1e6 : null, area_uncertainty_km2: a ? number(a[5]) / 1e6 : null,
      rank_on_mountain: a ? number(a[3]) : null,
      head_elevation_m: t ? number(t[0]) : null, terminus_elevation_m: t ? number(t[2]) : null,
      elevation_range_m: t ? number(t[4]) : null, length_km: t ? number(t[6]) : null,
      average_slope_deg: t ? number(t[8]) : null, flow_direction_deg: t ? number(t[9]) : null,
      flow_direction_label: t?.[10] ?? null, type_code: type?.[1] ?? null, type_label: type?.[2] ?? null,
      estimated_volume_km3: v ? number(v[4]) / 1e9 : null, volume_uncertainty_km3: v ? number(v[5]) / 1e9 : null,
      area_history: h, area_history_scope: h.length ? scope : null,
      percent_change_since_earliest: known.length > 1 ? (known[known.length - 1].area_km2! / known[0].area_km2! - 1) * 100 : null,
      description, description_source_url: pageUrl,
      provenance: {
        report: { doi: "10.36967/2299328", url: REPORT_URL, credit: FACTS_CREDIT, license: "U.S. Government work", observed_year: 2021 },
        tables: { area: "4, p.17 (m² converted to km²)", topography: "5, pp.20–21 (SI columns; integer mean slope)",
          history: "7, pp.25–26 (published km²; grouped names retained)", volume: "12, pp.38–39 (m³ converted to km³; statistical estimate)" },
        type_source_url: type && pageKey ? `https://www.nps.gov/places/${pageKey}-glacier.htm` : null,
        history_scope: h.length ? scope : null, percent_method: known.length > 1 ? "100 * (last / first - 1), first non-null year, Table 7 scope" : null,
        note: c.kind === "snowfield" ? "Muir Snowfield is not the NPS Muir Glacier; no facts assigned."
          : !a ? "No matching individual glacier in the 2021 report; facts unknown."
          : name === "Paradise" ? "Table 7 includes former Stevens Glacier; Stevens left the inventory in 2021."
          : historyNames[name!] ? "Table 7 reports a combined glacier system, not this glacier alone." : null,
      },
    };
  }
  return result;
}
export function sha256(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
