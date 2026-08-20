// The Discover search surface's URL contract, kept out of the components so
// it can be unit-tested and so the server-rendered chips and the client
// search island build identical links.
//
// Two params, both optional: `q` holds the query, `type` narrows the result
// scope. `all` is the default scope and never appears in the URL, so
// /discover, /discover?q=rainier and /discover?q=rainier&type=all all
// address the same view instead of three.

export const SEARCH_SCOPES = [
  "all",
  "destinations",
  "areas",
  "routes",
  "lists",
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** Anything unrecognised — a hand-edited URL, a scope that used to exist —
 * reads as `all` rather than showing an empty view for a scope with no
 * results section. */
export function parseSearchScope(value: string | null | undefined): SearchScope {
  return SEARCH_SCOPES.includes(value as SearchScope) ? (value as SearchScope) : "all";
}

/**
 * A /discover link with one or both params changed, keeping every other
 * param the current URL carries.
 *
 * `currentSearch` is a query string (with or without its leading "?"), i.e.
 * `useSearchParams().toString()` on the client or "" on the server. An
 * override of `null` (or an all-whitespace query) removes its param;
 * omitting the key leaves that param alone.
 */
export function buildDiscoverHref(
  currentSearch: string,
  overrides: { query?: string | null; scope?: SearchScope | null } = {}
): string {
  const params = new URLSearchParams(currentSearch);

  if (overrides.query !== undefined) {
    const trimmed = overrides.query?.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
  }

  if (overrides.scope !== undefined) {
    if (overrides.scope && overrides.scope !== "all") params.set("type", overrides.scope);
    else params.delete("type");
  }

  const next = params.toString();
  return next ? `/discover?${next}` : "/discover";
}
