"use client";

import type { ExploreResult } from "../../lib/explore-results";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { CatalogFilters } from "../discover/catalog-filters";
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
  filterSearch,
  onFiltersChange,
  error,
  onRetry,
  footer,
  selection,
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
  filterSearch?: string;
  onFiltersChange?: (changes: Record<string,string|number|null>) => void;
  error?: string;
  onRetry?: () => void;
  footer?: ReactNode;
  selection?: ReactNode;
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
            placeholder="Search a peak, park, or route"
            aria-label="Search peaks, parks, routes, and lists"
            className="h-12 w-full rounded-ctl border border-border bg-page pl-9 pr-11 text-sm text-ink placeholder:text-muted"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-ctl text-muted transition-colors hover:text-ink-2"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        <p role="status" aria-live="polite" className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
          <span>{countLine}</span>
          {loading || searching ? (
            <Spinner className="h-3.5 w-3.5 text-faint" />
          ) : null}
        </p>
        {hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {filterSearch!==undefined&&onFiltersChange?<details className="border-b border-hairline px-4 py-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink">Location & filters</summary><CatalogFilters search={filterSearch} onChange={onFiltersChange} compact/><label className="mt-3 block pb-3 text-xs text-muted">Show<select aria-label="Map result type" value={new URLSearchParams(filterSearch).get("type")??"all"} onChange={event=>onFiltersChange({type:event.target.value})} className="mt-1 min-h-11 w-full rounded-ctl border border-border bg-page px-3 text-sm text-ink"><option value="all">All places and routes</option><option value="destinations">Peaks & places</option><option value="routes">Routes</option><option value="areas">Parks & areas</option><option value="lists">Lists</option></select></label></details>:null}
        {selection}
        {error?<div role="alert" className="m-4 rounded-ctl border border-alert/30 p-4"><p className="text-sm text-alert">{error}</p><button type="button" onClick={onRetry} className="mt-2 min-h-11 text-sm font-medium text-accent-text underline">Try again</button></div>:null}
        {results.length === 0 ? (
          // Nothing to say yet while a read is in flight — the count line
          // above already reads "Loading results…" beside its spinner, and
          // "No matches" under it would be a claim we can't make.
          loading || searching || error ? null : (
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
            {!error&&results.map((result) => (
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
        {footer}
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
  const href=result.href??`/${result.kind==="route"?"routes":result.kind==="area"?"areas":result.kind==="list"?"lists":"destinations"}/${encodeURIComponent(result.id)}`;
  return <div>
    <button
      type="button"
      onClick={() => onPick(result)}
      onMouseEnter={() => onHover(result)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(result)}
      onBlur={() => onHover(null)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill ${
        selected ? "bg-fill" : ""
      }`}
    >
      {result.imageUrl?<span className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-fill"><Image src={result.imageUrl} alt="" width={80} height={64} unoptimized className="h-full w-full object-cover"/></span>:null}
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[15px] font-medium ${
            selected ? "text-accent-text" : "text-ink"
          }`}
        >
          {result.name || (result.kind === "route" ? "Unnamed route" : "Unnamed")}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">
          <ResultDetail result={result} />
        </span>
        {result.locationLabel?<span className="mt-0.5 block text-xs text-muted">{result.locationLabel}</span>:null}
      </span>
      {result.kind!=="list"?<span className="shrink-0 text-xs text-muted">
        {formatDistanceMeters(result.metersFromCenter)}
      </span>:null}
    </button>
    {result.imageUrl&&result.imageAttribution?<p className="px-4 text-xs leading-5 text-muted">Photo: {result.imageAttributionUrl?<a href={result.imageAttributionUrl} target="_blank" rel="noopener noreferrer" className="underline">{result.imageAttribution}</a>:result.imageAttribution}</p>:null}
    <Link href={href} className="mx-4 mb-2 inline-flex min-h-11 items-center text-sm font-medium text-accent-text">Open {result.kind==="list"?"list":"guide"} →</Link>
  </div>;
}

/** Type and route length stay readable without opening the guide. */
function ResultDetail({ result }: { result: ExploreResult }) {
  if (result.kind === "route") {
    return (
      <>
        {result.typeWord}
        {result.routeDistance!=null&&result.routeDistance>80467.2?" · whole long-distance route":null}
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
  return <span className="tabular-nums">{children}</span>;
}
