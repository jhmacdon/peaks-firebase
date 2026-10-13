export type SearchResultType = "destination" | "route" | "area" | "list";

export interface SearchBuckets {
  destinations: any[];
  routes: any[];
  areas: any[];
  lists: any[];
}

export interface RankedSearchResult {
  type: SearchResultType;
  id: string;
  score: number;
  data: any;
}

/**
 * The same text weights apply to every entity, including individual aliases.
 * Whole-string similarity keeps shorter, closer names first; word similarity
 * and a word-start bonus keep a longer real name ("Mount Pilchuck" for
 * "pilchuck") from being buried under a short exact namesake.
 */
export function searchTextScoreSql(term: string, query: string, prefix: string): string {
  return `(similarity(${term}, ${query}) * 0.45
    + word_similarity(${query}, ${term}) * 0.20
    + CASE WHEN ${term} LIKE ${prefix} OR ${term} LIKE ('% ' || ${query} || '%') THEN 0.15 ELSE 0 END
    + CASE WHEN ${term} = ${query} THEN 0.10 ELSE 0 END)`;
}

/**
 * Places people rarely search for by name (a campsite or trailhead alone)
 * yield to the summit, lake or trail that shares the word. An exact full-name
 * query still finds them first among their namesakes.
 */
export function searchMinorPlacePenaltySql(features: string): string {
  return `(CASE WHEN ${features} <> '{}' AND ${features} <@ '{campsite,trailhead}'::destination_feature[] THEN 0.35 ELSE 0 END)`;
}

/** Bounded popularity keeps a popular weak match below a strong text match. */
export function searchPopularityScoreSql(count: string): string {
  return `(LEAST(LN(1 + GREATEST(COALESCE(${count}, 0), 0)) / LN(1001.0), 1) * 0.10)`;
}

function boundedScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

function destinationTiePriority(result: RankedSearchResult): number {
  return result.type === "destination" && result.data.features?.includes("summit") ? 1 : 0;
}

export function rankSearchResults(buckets: SearchBuckets, limit: number): RankedSearchResult[] {
  const destinations = new Map(buckets.destinations.map((row) => [row.id, row]));
  const groups: [SearchResultType, any[]][] = [
    ["destination", buckets.destinations],
    ["route", buckets.routes],
    ["area", buckets.areas],
    ["list", buckets.lists],
  ];
  const results = groups.flatMap(([type, rows]) => rows.map((data): RankedSearchResult => {
    let score = boundedScore(data.score);
    // A named lake/waterfall hike answers the same query as its objective.
    // Apply this only when that objective also matched, never to summit routes
    // or to an unrelated route that happened to use the same trail segment.
    if (type === "route" && data.kind === "destination") {
      const objective = destinations.get(data.objective_destination_id);
      if (objective) score = Math.max(score, Math.min(1, boundedScore(objective.score) + 0.02));
    }
    if (type === "route" && data.kind === "summit") {
      const objective = destinations.get(data.objective_destination_id);
      // A broad place-name prefix should lead with the summit, even when a
      // shorter shared trail name gives its route a higher text score. Exact
      // route, alias, or trail queries still lead with the matching route.
      if (objective?.name_exact_match || (objective?.name_prefix_match && !data.term_exact_match)) {
        score = Math.min(score, Math.max(0, boundedScore(objective.score) - 0.001));
      }
    }
    return { type, id: String(data.id), score, data };
  }));

  return results.sort((a, b) => b.score - a.score
    || destinationTiePriority(b) - destinationTiePriority(a)
    || String(a.data.name ?? "").localeCompare(String(b.data.name ?? ""), "en")
    || a.type.localeCompare(b.type)
    || a.id.localeCompare(b.id)).slice(0, limit);
}

// Fields a client needs to label a ranked result without its bucket row.
// The full row stays in its bucket; repeating it here sent every route
// polyline twice in one response.
const SUMMARY_FIELDS = ["name", "type", "kind", "features", "state_code", "country_code", "elevation"] as const;

export function summarizeSearchResults(results: RankedSearchResult[]): RankedSearchResult[] {
  return results.map((result) => ({
    ...result,
    data: Object.fromEntries(SUMMARY_FIELDS
      .filter((field) => result.data?.[field] !== undefined)
      .map((field) => [field, result.data[field]])),
  }));
}
