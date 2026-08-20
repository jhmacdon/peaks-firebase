"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "../ui/empty-state";
import { ResultGroups } from "./discover-result-groups";
import { useDiscoverState } from "./discover-state";
import {
  buildDiscoverHref,
  parseSearchScope,
  type SearchScope,
} from "../../lib/discover-search";
import {
  searchAreas,
  searchDestinations,
  searchRoutes,
  type SearchAreaResult,
  type SearchDestination,
  type SearchRouteResult,
} from "../../lib/actions/search";
import { getLists, type ListRow } from "../../lib/actions/lists";

interface Results {
  /** The query these rows answer, so a stale set is never labelled with the
   * query the reader has since typed. */
  query: string;
  destinations: SearchDestination[];
  areas: SearchAreaResult[];
  routes: SearchRouteResult[];
  lists: ListRow[];
}

const NO_RESULTS: Results = {
  query: "",
  destinations: [],
  areas: [],
  routes: [],
  lists: [],
};

/**
 * The search island: everything that depends on `?q=`.
 *
 * Results are fetched in the browser rather than rendered on the server, so
 * the page itself stays static and cacheable — the catalog sections beside
 * this island are an hour old at worst, and a search is always live.
 */
export function DiscoverResults() {
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const query = (searchParams.get("q") ?? "").trim();
  const scope = parseSearchScope(searchParams.get("type"));
  const { lat, lng, setSearching } = useDiscoverState();

  const [results, setResults] = useState<Results>(NO_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tells the browse stack beside this island to stand down.
  useEffect(() => {
    setSearching(query.length > 0);
  }, [query, setSearching]);

  useEffect(() => {
    if (!query) {
      setResults(NO_RESULTS);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      searchDestinations(query, lat ?? undefined, lng ?? undefined, 9),
      searchAreas(query, 6),
      searchRoutes(query, 6),
      getLists(query, 6, 0),
    ])
      .then(([destinations, areas, routes, lists]) => {
        if (cancelled) return;
        setResults({ query, destinations, areas, routes, lists: lists.lists });
      })
      .catch(() => {
        if (cancelled) return;
        setResults({ ...NO_RESULTS, query });
        setError(
          "Search is unavailable right now. Refresh the page or try another search."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, lat, lng]);

  if (!query) return null;

  const resolved = !loading && results.query === query;
  const scopes: { id: SearchScope; label: string; count: number }[] = [
    {
      id: "all",
      label: "All results",
      count:
        results.destinations.length +
        results.areas.length +
        results.routes.length +
        results.lists.length,
    },
    { id: "destinations", label: "Peaks & places", count: results.destinations.length },
    { id: "areas", label: "Protected areas", count: results.areas.length },
    { id: "routes", label: "Routes", count: results.routes.length },
    { id: "lists", label: "Lists", count: results.lists.length },
  ];
  const activeScope = scopes.find((item) => item.id === scope) ?? scopes[0];
  const shown = activeScope.count;
  const countLine = `${shown} result${shown === 1 ? "" : "s"}${
    scope === "all" ? " across the catalog." : ` in ${activeScope.label.toLowerCase()}.`
  }`;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[22px] font-medium text-ink">
          {error
            ? "Search unavailable"
            : resolved
              ? `Results for “${query}”`
              : "Searching…"}
        </h2>
        <Link
          href={buildDiscoverHref(currentSearch, { query: null, scope: null })}
          className="text-sm font-medium text-accent-text hover:underline"
        >
          Clear search
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-sm text-alert">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          {resolved
            ? countLine
            : "Looking across destinations, protected areas, routes, and lists."}
        </p>
      )}

      {/* Scope filters — dropped entirely when the search itself failed,
          rather than offering five ways to look at nothing.

          Real links, not the `Tabs` component: the scope is URL state, so
          each one has to be a place you can open, bookmark, or middle-click.
          They just wear the same underline treatment. */}
      <nav
        aria-label="Result types"
        className={`mt-5 flex-wrap items-center gap-x-6 border-b border-hairline ${
          error ? "hidden" : "flex"
        }`}
      >
        {scopes.map((item) => {
          const active = item.id === scope;
          return (
            <Link
              key={item.id}
              href={buildDiscoverHref(currentSearch, { scope: item.id })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-accent text-accent-text"
                  : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {item.label}
              {/* No count until the results are in — a row of zeroes beside
                  "Searching…" reads as "nothing found". */}
              {resolved ? (
                <span className="ml-1.5 font-mono-num tabular-nums text-muted">
                  {item.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {resolved && !error && shown === 0 ? (
        <EmptyState
          className="mt-4"
          title={`No matches for “${query}” in this view.`}
          description="Try a broader search, switch result types, or start from one of the popular searches above."
        />
      ) : null}

      {resolved ? (
        <div className={shown > 0 ? "mt-8 space-y-12" : undefined}>
          <ResultGroups
            scope={scope}
            destinations={results.destinations}
            areas={results.areas}
            routes={results.routes}
            lists={results.lists}
          />
        </div>
      ) : null}
    </div>
  );
}

