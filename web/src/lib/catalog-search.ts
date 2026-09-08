import { allUsStateCodes } from "./regions";
import { parseSearchScope, type SearchScope } from "./discover-search";

export const CATALOG_PAGE_SIZE = 12;
export const CATALOG_SORTS = ["relevance", "nearest", "distance", "elevation", "name"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export type CatalogKind = Exclude<SearchScope, "all">;
export interface CatalogFilters {
  query: string;
  scope: SearchScope;
  state: string;
  area: string;
  activity: "" | "hiking" | "skiing" | "motorized";
  difficulty: "" | "easy" | "moderate" | "hard" | "strenuous";
  maxDistance: number | null;
  maxGain: number | null;
  sort: CatalogSort;
  page: number;
  nearLat: number | null;
  nearLng: number | null;
}

const positive = (value: string | null, max: number): number | null => {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : null;
};
const coordinate = (value: string | null, max: number): number | null => {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null;
};

export function parseCatalogFilters(search: string): CatalogFilters {
  const p = new URLSearchParams(search);
  const state = (p.get("state") ?? "").toUpperCase();
  const activity = p.get("activity") ?? "";
  const difficulty = p.get("difficulty") ?? "";
  const sort = p.get("sort") ?? "relevance";
  const lat = coordinate(p.get("nearLat"), 90);
  const lng = coordinate(p.get("nearLng"), 180);
  return {
    query: (p.get("q") ?? "").trim().slice(0, 120),
    scope: parseSearchScope(p.get("type")),
    state: allUsStateCodes().includes(state) ? state : "",
    area: (p.get("area") ?? "").slice(0, 160),
    activity: ["hiking", "skiing", "motorized"].includes(activity) ? activity as CatalogFilters["activity"] : "",
    difficulty: ["easy", "moderate", "hard", "strenuous"].includes(difficulty) ? difficulty as CatalogFilters["difficulty"] : "",
    maxDistance: positive(p.get("maxDistance"), 3000),
    maxGain: positive(p.get("maxGain"), 100000),
    sort: CATALOG_SORTS.includes(sort as CatalogSort) ? sort as CatalogSort : "relevance",
    page: Math.max(1, Math.floor(positive(p.get("page"), 100000) ?? 1)),
    nearLat: lat !== null && lng !== null ? lat : null,
    nearLng: lat !== null && lng !== null ? lng : null,
  };
}

export function hasCatalogSelection(f: CatalogFilters): boolean {
  return Boolean(f.query || f.state || f.area || f.activity || f.difficulty || f.maxDistance || f.maxGain || f.nearLat !== null || f.scope !== "all");
}

/** Result and map views carry the same filter state. Paging resets on any
 * change to the set or order, but never when simply changing views. */
export function catalogHref(path: "/discover" | "/map", current: string, changes: Record<string, string | number | null> = {}): string {
  const p = new URLSearchParams(current);
  if (Object.keys(changes).some(key => !["page", "selected", "lat", "lng", "z", "types"].includes(key))) p.delete("page");
  if (changes.type !== undefined && changes.type !== "routes") {
    for (const key of ["maxDistance", "maxGain", "difficulty"]) p.delete(key);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "" || (key === "type" && value === "all") || (key === "page" && value === 1)) p.delete(key);
    else p.set(key, String(value));
  }
  if (path === "/discover") {
    for (const key of ["lat", "lng", "z", "types", "selected"]) p.delete(key);
  }
  return `${path}${p.size ? `?${p.toString()}` : ""}`;
}

export function parseCatalogSelection(value: string | null): { kind: CatalogKind; id: string } | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return separator > 0 && ["destinations", "routes", "areas", "lists"].includes(kind) && id.length > 0 && id.length <= 160
    ? { kind: kind as CatalogKind, id } : null;
}
