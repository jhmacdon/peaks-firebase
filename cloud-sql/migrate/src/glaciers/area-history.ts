/** Generic area-history rules. Builders say which observations their source
 * calls low-accuracy; nothing here names a glacier or a mountain.
 *
 * Stored per facts row under `provenance`, and served flat by the API:
 * - `provenance.area_history_note` → `area_history_note`, `area_history_note_citation`
 * - `provenance.area_change` → `change_baseline_year`, `percent_change_since_baseline`
 * - `provenance.surface_change` → `surface_change`
 */
export type AreaAccuracy = "low" | null;
export interface AreaObservation { year: number; area_km2: number | null; uncertainty_km2: number | null; accuracy: AreaAccuracy }

/** A source's own warning about some survey years, with where it says so. */
export interface LowAccuracySurveys {
  years: number[];
  /** Short plain wording of the source's warning, for a muted footnote. */
  text: string;
  /** "Author (year), p.N". */
  citation: string;
  /** Exact sentence start in the saved source text; the builder fails closed without it. */
  source_quote: string;
}

export interface AreaHistoryNote { text: string; citation: string; low_accuracy_years: number[] }

/** Headline change from the earliest observation the source does not call
 * low-accuracy, to the latest one. */
export interface AreaChange { baseline_year: number; end_year: number; percent: number; method: string }

/** Mean surface-elevation and volume change over one differenced period. */
export interface SurfaceChange {
  start_year: number; start_label: string; end_year: number;
  mean_elevation_change_m: number | null; mean_elevation_change_uncertainty_m: number | null;
  volume_change_km3: number | null; volume_change_uncertainty_km3: number | null;
  method: string; citation: string; credit: string; source_url: string | null;
}

/** Checks the warning against the saved source text before any year is flagged. */
export function checkLowAccuracySurveys(source: string, surveys: LowAccuracySurveys): LowAccuracySurveys {
  if (!surveys.years.length || !surveys.text.trim() || !surveys.citation.trim()) throw new Error("Empty low-accuracy survey note");
  const flat = source.replace(/\s+/g, " ");
  if (!flat.includes(surveys.source_quote.replace(/\s+/g, " "))) throw new Error(`Low-accuracy note not found in source: ${surveys.source_quote}`);
  for (const year of surveys.years) if (!surveys.source_quote.includes(String(year))) throw new Error(`Quote does not name ${year}`);
  return surveys;
}

export function markAccuracy(history: Omit<AreaObservation, "accuracy">[], surveys: LowAccuracySurveys | null): AreaObservation[] {
  const low = new Set(surveys?.years ?? []);
  return history.map(o => ({ ...o, accuracy: low.has(o.year) ? "low" : null }));
}

/** The note applies only when the series holds a measured low-accuracy year. */
export function areaHistoryNote(history: AreaObservation[], surveys: LowAccuracySurveys | null): AreaHistoryNote | null {
  const years = history.filter(o => o.accuracy === "low" && o.area_km2 !== null).map(o => o.year);
  return surveys && years.length ? { text: surveys.text, citation: surveys.citation, low_accuracy_years: years } : null;
}

/** Null when fewer than two measured, not-low observations remain. */
export function areaChangeSinceBaseline(history: AreaObservation[]): AreaChange | null {
  const usable = history.filter(o => o.area_km2 !== null && o.accuracy !== "low").sort((a, b) => a.year - b.year);
  const first = usable[0], last = usable[usable.length - 1];
  if (!first || !last || last.year <= first.year || !(first.area_km2! > 0)) return null;
  return { baseline_year: first.year, end_year: last.year, percent: (last.area_km2! / first.area_km2! - 1) * 100,
    method: "100 * (last / baseline - 1); baseline is the earliest measured year the source does not call low-accuracy" };
}
