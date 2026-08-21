"use client";

import type { ExploreResult } from "../../lib/explore-results";
import {
  formatDistanceMeters,
  formatElevationMeters,
} from "../../lib/route-guide";
import { EmptyState } from "../ui/empty-state";
import { CloseIcon, SearchIcon, Spinner } from "./explore-icons";

/**
 * The panel that floats over the map: a search field, an honest count, and
 * the results themselves as real rows — name, what it is, its elevation or
 * length, and how far it sits from the middle of the screen.
 *
 * The same component fills the desktop panel and the mobile sheet; only the
 * heading differs, since the sheet's own handle already names the view.
 */
export function ExplorePanel({
  showHeading,
  countLine,
  hint,
  loading,
  query,
  onQueryChange,
  searching,
  searchActive,
  results,
  selectedId,
  onPick,
  onHover,
}: {
  showHeading: boolean;
  countLine: string;
  hint: string | null;
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  searching: boolean;
  searchActive: boolean;
  results: ExploreResult[];
  selectedId: string | null;
  onPick: (result: ExploreResult) => void;
  onHover: (result: ExploreResult | null) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-hairline px-4 pb-3 pt-4">
        {showHeading ? (
          <h1 className="text-[20px] font-medium leading-tight text-ink">
            Explore the map
          </h1>
        ) : null}

        <div className={`relative ${showHeading ? "mt-3" : ""}`}>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onQueryChange("");
            }}
            placeholder="Search peaks and places"
            aria-label="Search peaks and places"
            className="h-10 w-full rounded-ctl border border-border bg-page pl-9 pr-9 text-sm text-ink placeholder:text-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-ctl p-1 text-faint transition-colors hover:text-ink-2"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        <p className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
          <span>{countLine}</span>
          {loading || searching ? (
            <Spinner className="h-3.5 w-3.5 text-faint" />
          ) : null}
        </p>
        {hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {results.length === 0 ? (
          // Nothing to say yet while a read is in flight — the count line
          // above already reads "Loading results…" beside its spinner, and
          // "No matches" under it would be a claim we can't make.
          loading || searching ? null : (
            <EmptyState
              title={searchActive ? "No matches" : "Nothing here yet"}
              description={
                searchActive
                  ? "Try a different name, or clear the search to see what's in view."
                  : "Pan or zoom the map, or turn on more filters."
              }
            />
          )
        ) : (
          <ul className="divide-y divide-hairline">
            {results.map((result) => (
              <li key={`${result.kind}-${result.id}`}>
                <ResultRow
                  result={result}
                  selected={result.id === selectedId}
                  onPick={onPick}
                  onHover={onHover}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  result,
  selected,
  onPick,
  onHover,
}: {
  result: ExploreResult;
  selected: boolean;
  onPick: (result: ExploreResult) => void;
  onHover: (result: ExploreResult | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(result)}
      onMouseEnter={() => onHover(result)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(result)}
      onBlur={() => onHover(null)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors hover:bg-fill ${
        selected ? "bg-fill" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[15px] font-medium ${
            selected ? "text-accent-text" : "text-ink"
          }`}
        >
          {result.name || (result.kind === "route" ? "Unnamed route" : "Unnamed")}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">
          <ResultDetail result={result} />
        </span>
      </span>
      <span className="shrink-0 font-mono-num text-[13px] tabular-nums text-faint">
        {formatDistanceMeters(result.metersFromCenter)}
      </span>
    </button>
  );
}

/** Type word first, then the numbers that describe it — every numeral in
 * Geist Mono (design-tokens.md: every stat value, everywhere). */
function ResultDetail({ result }: { result: ExploreResult }) {
  if (result.kind === "route") {
    return (
      <>
        {result.typeWord}
        {result.routeDistance != null ? (
          <>
            {" · "}
            <Num>{formatDistanceMeters(result.routeDistance)}</Num>
          </>
        ) : null}
        {result.routeGain != null ? (
          <>
            {" · "}
            <Num>{formatElevationMeters(result.routeGain)}</Num> gain
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      {result.typeWord}
      {result.elevation != null ? (
        <>
          {" · "}
          <Num>{formatElevationMeters(result.elevation)}</Num>
        </>
      ) : null}
    </>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono-num tabular-nums">{children}</span>;
}
