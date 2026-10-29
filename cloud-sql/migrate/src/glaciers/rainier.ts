import { createHash } from "node:crypto";
import { parseOsmGlaciers, type GlacierCandidate } from "./osm";
import { areaChangeSinceBaseline, areaHistoryNote, checkLowAccuracySurveys, markAccuracy,
  type AreaObservation, type LowAccuracySurveys, type SurfaceChange } from "./area-history";
export type { GlacierCandidate, Polygon, Position } from "./osm";

export const SNAPSHOT_SHA256 = "02cea8bc617563b180036921c7114b56e0234c359a0af174cf24becc37cf5cb0";
export const GEOMETRY_CREDIT = "© OpenStreetMap contributors";
export const FACTS_CREDIT = "Beason et al. (2023), National Park Service";
export const REPORT_URL = "https://doi.org/10.36967/2299328";
export const SNAPSHOT_DATE = "2026-10-28";
export type Observation = AreaObservation;
/** Beason et al. (2023) on the two oldest maps; the builder checks the quote
 * against the saved report text. */
export const LOW_ACCURACY_SURVEYS: LowAccuracySurveys = {
  years: [1896, 1913],
  text: "The 1896 and 1913 maps have poor spatial accuracy.",
  citation: "Beason et al. (2023), p.6",
  source_quote: "The older maps in 1896 and 1913 had poor spatial accuracy",
};
export interface GlacierFacts {
  inventory_name: string | null; kind: "glacier" | "snowfield"; observed_year: number | null;
  area_km2: number | null; area_uncertainty_km2: number | null; rank_on_mountain: number | null;
  head_elevation_m: number | null; terminus_elevation_m: number | null; elevation_range_m: number | null;
  length_km: number | null; average_slope_deg: number | null;
  flow_direction_deg: number | null; flow_direction_label: string | null;
  type_code: string | null; type_label: string | null;
  estimated_volume_km3: number | null; volume_uncertainty_km3: number | null;
  area_history: Observation[]; area_history_scope: string | null;
  /** Deprecated: includes low-accuracy surveys. See provenance.area_change. */
  percent_change_since_earliest: number | null;
  description: string | null; description_source_url: string | null;
  provenance: Record<string, unknown>;
}

/** Rainier's original parser: every named glacier in the snapshot; only Muir Snowfield is a snowfield. */
export const parseGlaciers = (snapshot: unknown): GlacierCandidate[] => parseOsmGlaciers(snapshot, { snowfields: ["Muir Snowfield"] });

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
  const surveys = checkLowAccuracySurveys(report, LOW_ACCURACY_SURVEYS);
  const history = new Map<string, Observation[]>();
  for (const line of table(report, "Table 7.", "Table 8.")) {
    const m = line.match(/^([A-Za-z -]+?)\s{2,}(.*±.*)$/);
    if (!m) continue;
    const cells = [...m[2].matchAll(/(\d+\.\d+)\s+±\s+(\d+\.\d+)|–/g)];
    if (cells.length !== 7) throw new Error(`Unexpected Table 7 row: ${m[1]}`);
    history.set(m[1].trim(), markAccuracy(cells.map((v, i) => ({ year: [1896,1913,1971,1994,2009,2015,2021][i],
      area_km2: v[1] ? number(v[1]) : null, uncertainty_km2: v[2] ? number(v[2]) : null })), surveys));
  }
  const volumes = new Map<string, RegExpMatchArray>();
  const volumeStart = report.indexOf("\nTable 12. Estimated", report.indexOf("\fTable 7."));
  const volumeEnd = report.indexOf("\n5.7. Glacial Volume Change", volumeStart);
  if (volumeStart < 0 || volumeEnd < 0) throw new Error("Missing Table 12");
  for (const line of report.slice(volumeStart, volumeEnd).split(/\r?\n/)) {
    const m = line.match(/^(.+?)\s{2,}([A-Z]{3})\s+(\d+)\s+([\d,]+)\s+±\s+([\d,]+)/);
    if (m) volumes.set(m[2], m);
  }
  // Table 11 names glaciers individually, with "N."/"S." for North/South.
  const thinning = new Map<string, RegExpMatchArray>();
  // Skip the List of Tables entry: the table body follows Table 7.
  const thinStart = report.indexOf("\nTable 11. Total volumetric change", report.indexOf("\fTable 7."));
  const thinEnd = report.indexOf("\n5.6. 2021 Glacier Volume", thinStart);
  if (thinStart < 0 || thinEnd < 0) throw new Error("Missing Table 11");
  for (const line of report.slice(thinStart, thinEnd).split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Za-z. ]+?)\s{2,}(-?\d+\.\d+) ± (\d+\.\d+)\s+(-?[\d,]+) ± ([\d,]+)\s+-?\d+\.\d+ ±\s*\d+\.\d+\s*$/);
    if (m) thinning.set(m[1].trim().replace(/^N\. /, "North ").replace(/^S\. /, "South "), m);
  }
  if (areas.size !== 28 || topo.size !== 28 || volumes.size !== 28 || history.size !== 25 || thinning.size !== 29)
    throw new Error(`Incomplete report: area=${areas.size}, topography=${topo.size}, volume=${volumes.size}, history=${history.size}, thinning=${thinning.size}`);
  const result: Record<string, GlacierFacts> = {};
  for (const c of candidates) {
    const name = Object.prototype.hasOwnProperty.call(reportNames, c.name) ? reportNames[c.name] : c.name.replace(/ Glacier$/, "");
    const a = name ? areas.get(name) : undefined, t = name ? topo.get(name) : undefined;
    const v = a ? volumes.get(a[2]) : undefined;
    const scope = name ? historyNames[name] ?? name : null;
    const h = (scope ? history.get(scope) : undefined) ?? [];
    const known = h.filter(o => o.area_km2 !== null);
    const th = name ? thinning.get(name) : undefined;
    const surface: SurfaceChange | null = th ? {
      start_year: 2007, start_label: "2007/8", end_year: 2021,
      mean_elevation_change_m: number(th[2]), mean_elevation_change_uncertainty_m: number(th[3]),
      volume_change_km3: number(th[4]) / 1e9, volume_change_uncertainty_km3: number(th[5]) / 1e9,
      method: "2021 SfM surface model minus the 2007/8 LiDAR bare-earth model, clipped to the 2009 glacier extents",
      citation: "Beason et al. (2023), Table 11, pp.36–37 (m³ converted to km³)", credit: FACTS_CREDIT, source_url: REPORT_URL,
    } : null;
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
          history: "7, pp.25–26 (published km²; grouped names retained; 1896 and 1913 low accuracy per p.6)",
          surface_change: "11, pp.36–37 (individual glaciers; m³ converted to km³)", volume: "12, pp.38–39 (m³ converted to km³; statistical estimate)" },
        type_source_url: type && pageKey ? `https://www.nps.gov/places/${pageKey}-glacier.htm` : null,
        area_history_note: areaHistoryNote(h, surveys), area_change: areaChangeSinceBaseline(h), surface_change: surface,
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
