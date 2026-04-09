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
    .split(/\s+/)
    .map((word) => ABBREVIATIONS[word] || word)
    .join(" ")
    .trim();
}
