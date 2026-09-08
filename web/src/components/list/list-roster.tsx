"use client";

import { useMemo, useState } from "react";
import { filterListRoster } from "../../lib/list-roster-filter";
import { Input, Label, Select } from "../ui/field";
import { Button } from "../ui/button";
import Link from "next/link";
import type { ListDestination } from "../../lib/actions/lists";
import { formatFeetValue, formatShortDate, titleize } from "../../lib/destination-detail";
import { effectiveListCompletionTarget } from "../../lib/list-completion";
import { satelliteThumbnailUrl } from "../../lib/satellite-thumbnail";
import { TrophyGlyph } from "../session/activity-glyph";
import ProgressBar from "../progress-bar";
import { SectionHeading } from "../ui/section-heading";
import { useListCompletion } from "./list-completion-context";

function MountainPlaceholder() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-6 w-6 text-muted"
      aria-hidden="true"
    >
      <path
        d="M7 36 19 16l6.5 10L30 20l11 16Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The destinations on this list, with a signed-in reader's own
 * completion layered on: a progress bar above the rows, a 48px thumbnail per row
 * (destination-nearby.tsx's pattern), and a trailing trophy + date on any
 * row they've reached. Reads useListCompletion() (list-completion-context.tsx)
 * rather than fetching its own copy, so it shares one request with the map
 * hero (Task 5).
 *
 * The completion map is sparse — a destination with no reached session has
 * no key at all — so every lookup here is a guarded `entries?.[id]`, never
 * a direct index. Signed out (or still loading), `entries` is null and rows
 * render with no marks and no progress bar; empty-list copy is unchanged. */
export function ListRoster({
  destinations,
  completionTarget,
  className = "",
}: {
  destinations: ListDestination[];
  completionTarget: number;
  className?: string;
}) {
  const { entries, signedIn, error, retry } = useListCompletion();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "reached" | "remaining">("all");
  const [sort, setSort] = useState<"list" | "name" | "elevation">("list");
  const [shown, setShown] = useState(50);
  const matching = useMemo(() => filterListRoster(destinations, { query, status, sort, entries }), [destinations, query, status, sort, entries]);
  const memberCount = destinations.length;
  const effectiveTarget = effectiveListCompletionTarget(completionTarget, memberCount);
  const completedCount = entries ? Object.keys(entries).length : 0;
  const usesSatelliteImagery = destinations.some(
    (destination) =>
      !destination.hero_image &&
      satelliteThumbnailUrl(destination.lat, destination.lng) != null
  );

  return (
    <section className={className} aria-labelledby="list-destinations">
      <SectionHeading>
        <span id="list-destinations">
          Destinations{destinations.length > 0 ? ` (${destinations.length})` : ""}
        </span>
      </SectionHeading>

      {entries && destinations.length > 0 ? (
        <div className="mt-4 max-w-sm">
          <ProgressBar completed={completedCount} total={effectiveTarget} />
          {effectiveTarget < memberCount ? (
            <p className="mt-2 text-sm text-muted">
              Reach any {effectiveTarget.toLocaleString("en-US")} of the{" "}
              {memberCount.toLocaleString("en-US")} destinations to complete this list.
              {completedCount > effectiveTarget
                ? ` ${completedCount.toLocaleString("en-US")} reached.`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {error && <div className="mt-4 flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-alert">Couldn’t load your list progress.</p><Button variant="secondary" size="sm" onClick={retry}>Try again</Button></div>}
      <div className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div><Label htmlFor="roster-search">Find a place on this list</Label><Input id="roster-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setShown(50); }} placeholder="Search names or regions" /></div>
        <div><Label htmlFor="roster-status">Your progress</Label><Select id="roster-status" value={status} disabled={!entries} onChange={(event) => { setStatus(event.target.value as typeof status); setShown(50); }}><option value="all">All places</option><option value="remaining">Not yet reached</option><option value="reached">Reached</option></Select></div>
        <div><Label htmlFor="roster-sort">Sort by</Label><Select id="roster-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setShown(50); }}><option value="list">List order</option><option value="name">Name</option><option value="elevation">Highest first</option></Select></div>
      </div>
      {!signedIn && <p className="mt-2 text-sm text-muted">Sign in to filter by the places you’ve reached.</p>}
      <p role="status" className="mt-4 text-sm text-muted">{matching.length.toLocaleString("en-US")} matching places</p>
      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">This list has no destinations yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {matching.slice(0, shown).map((destination) => {
            const elevation = formatFeetValue(destination.elevation);
            const featureWord = destination.features[0] ? titleize(destination.features[0]) : null;
            const completion = entries?.[destination.id] ?? null;
            const satelliteUrl = destination.hero_image
              ? null
              : satelliteThumbnailUrl(destination.lat, destination.lng);
            const thumbnailUrl = destination.hero_image ?? satelliteUrl;

            return (
              <li key={destination.id}>
                <Link
                  href={`/destinations/${destination.id}`}
                  className="group flex items-center gap-3"
                >
                  <span className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill">
                    <MountainPlaceholder />
                    {thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                        style={{
                          objectPosition: destination.hero_image
                            ? `${destination.hero_image_focal_x}% ${destination.hero_image_focal_y}%`
                            : "50% 50%",
                        }}
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink group-hover:underline">
                      {destination.name || "Unnamed"}
                    </span>
                    {elevation || featureWord ? (
                      <span className="mt-0.5 block text-sm text-muted">
                        {elevation ? (
                          <span className="tabular-nums">{elevation} ft</span>
                        ) : null}
                        {elevation && featureWord ? " · " : null}
                        {featureWord}
                      </span>
                    ) : null}
                  </span>
                  {completion ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
                      <TrophyGlyph className="h-4 w-4 text-muted" />
                      <span className="sr-only">Reached </span>
                      {completion.reached_at ? formatShortDate(completion.reached_at) : null}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {destinations.length > 0 && matching.length === 0 && <p className="mt-6 text-muted">No places match. Try another name or change the progress filter.</p>}
      {matching.length > shown && <Button variant="secondary" onClick={() => setShown((count) => count + 50)} className="mt-6">Show 50 more places</Button>}
      {usesSatelliteImagery ? (
        <p className="mt-5 text-xs text-muted">
          Satellite imagery ©{" "}
          <a
            href="https://www.esri.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink-2"
          >
            Esri
          </a>
          , Maxar, Earthstar Geographics.
        </p>
      ) : null}
    </section>
  );
}
