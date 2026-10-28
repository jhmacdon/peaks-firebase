/**
 * Geographic abbreviation expansion for search normalization.
 * Applied to both stored search_name and query input so
 * "mt rainier" matches "mount rainier", etc.
 */

const ABBREVIATIONS: Record<string, string> = {
  mt: "mount",
  mtn: "mountain",
  pt: "point",
  st: "saint",
  ft: "fort",
  lk: "lake",
  pk: "peak",
  cr: "creek",
  crk: "creek",
  cyn: "canyon",
  jct: "junction",
  spgs: "springs",
  spr: "spring",
  fk: "fork",
  br: "bridge",
  brg: "bridge",
  trl: "trail",
  hwy: "highway",
  rd: "road",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/**
 * Normalize a name for search: lowercase and expand common
 * geographic abbreviations to their full form.
 */
export function normalizeSearchName(name: string): string {
  return name
    .toLowerCase()
    // A compound like "Interglacier" also finds "Inter Glacier".
    .replace(/\b([a-z]+)glacier\b/g, "$1 glacier")
    // "mt." is "mt": drop a period after a letter ("12.4" keeps its own).
    // Mirrors peaks_search_name() in SQL.
    .replace(/(\p{L})\./gu, "$1")
    .split(/\s+/)
    .map((word) => ABBREVIATIONS[word] || word)
    .join(" ")
    .trim();
}
