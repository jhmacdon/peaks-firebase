"use client";

import { useState } from "react";
import Link from "next/link";
import type { AreaDestination } from "../../lib/actions/areas";
import {
  sortAreaDestinations,
  type AreaDestinationSort,
} from "../../lib/area-destination-sort";
import {
  describeDestinationType,
  formatFeetValue,
  formatShortDate,
} from "../../lib/destination-detail";
import { satelliteThumbnailUrl } from "../../lib/satellite-thumbnail";
import { TrophyGlyph } from "../session/activity-glyph";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { SectionHeading } from "../ui/section-heading";
import { useAreaPersonalization } from "./area-personalization";

type CompletionFilter = "all" | "reached" | "open";

const INITIAL_VISIBLE_COUNT = 12;

export function AreaDestinations({
  destinations,
  totalCount,
  className = "",
}: {
  destinations: AreaDestination[];
  totalCount: number;
  className?: string;
}) {
  const { activity, signedIn } = useAreaPersonalization();
  const [sort, setSort] = useState<AreaDestinationSort>("prominence");
  const [filter, setFilter] = useState<CompletionFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const completions = activity?.reached_destinations ?? null;

  const sorted = sortAreaDestinations(destinations, sort);
  const filtered = sorted.filter((destination) => {
    if (!completions || filter === "all") return true;
    const reached = completions[destination.id] != null;
    return filter === "reached" ? reached : !reached;
  });
  const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE_COUNT);
  const usesSatelliteImagery = visible.some(
    (destination) =>
      !destination.hero_image &&
      satelliteThumbnailUrl(destination.lat, destination.lng) != null
  );

  return (
    <section className={className} aria-labelledby="area-destinations">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionHeading>
            <span id="area-destinations">Peaks and destinations</span>
          </SectionHeading>
          <p className="mt-2 max-w-[68ch] text-sm text-muted">
            {sortDescription(sort, destinations.length, totalCount)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as AreaDestinationSort);
              setExpanded(false);
            }}
            className="h-9 rounded-ctl border border-border bg-page px-3 text-[13px] text-ink"
          >
            <option value="prominence">Prominence</option>
            <option value="elevation">Elevation</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {signedIn && completions ? (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Filter destinations">
          <Chip
            selected={filter === "all"}
            onClick={() => {
              setFilter("all");
              setExpanded(false);
            }}
          >
            All {destinations.length}
          </Chip>
          <Chip
            selected={filter === "reached"}
            onClick={() => {
              setFilter("reached");
              setExpanded(false);
            }}
          >
            Reached {countReached(destinations, completions)}
          </Chip>
          <Chip
            selected={filter === "open"}
            onClick={() => {
              setFilter("open");
              setExpanded(false);
            }}
          >
            Not yet {destinations.length - countReached(destinations, completions)}
          </Chip>
        </div>
      ) : null}

      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No catalog destinations are linked to this area yet.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No destinations match this filter.</p>
      ) : (
        <ol className="mt-6 grid gap-x-10 gap-y-5 md:grid-cols-2">
          {visible.map((destination) => {
            const rank = sorted.findIndex((item) => item.id === destination.id) + 1;
            const elevation = formatFeetValue(destination.elevation);
            const prominence = formatFeetValue(destination.prominence);
            const typeLabel = describeDestinationType(
              destination.type,
              destination.features
            );
            const completion = completions?.[destination.id] ?? null;
            const satelliteUrl = destination.hero_image
              ? null
              : satelliteThumbnailUrl(destination.lat, destination.lng);
            const thumbnailUrl = destination.hero_image ?? satelliteUrl;
            const secondary = destinationMeta(sort, elevation, prominence, typeLabel);

            return (
              <li key={destination.id}>
                <Link
                  href={`/destinations/${destination.id}`}
                  className="group flex items-center gap-3"
                >
                  <span className="w-6 shrink-0 text-right font-mono-num text-[11px] tabular-nums text-faint">
                    {rank.toString().padStart(2, "0")}
                  </span>
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill">
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
                    {secondary ? (
                      <span className="mt-0.5 block text-[12px] text-muted">{secondary}</span>
                    ) : null}
                  </span>
                  {completion ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-success">
                      <TrophyGlyph className="h-4 w-4" />
                      <span>
                        Reached
                        {completion.reached_at
                          ? ` ${formatShortDate(completion.reached_at)}`
                          : ""}
                      </span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {filtered.length > INITIAL_VISIBLE_COUNT ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-7"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </Button>
      ) : null}

      {usesSatelliteImagery ? (
        <p className="mt-5 text-[10px] text-muted">
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

function sortDescription(
  sort: AreaDestinationSort,
  loadedCount: number,
  totalCount: number
): string {
  const hasPartialRoster = loadedCount < totalCount;
  const count = loadedCount.toLocaleString("en-US");
  const total = totalCount.toLocaleString("en-US");
  if (sort === "prominence") {
    const scope = hasPartialRoster
      ? `The ${count} most prominent of ${total} catalog places`
      : `All ${total} catalog places`;
    return `${scope}, ranked by how far each summit rises above nearby terrain.`;
  }
  const scope = hasPartialRoster
    ? `The ${count} most prominent catalog places`
    : `All ${total} catalog places`;
  if (sort === "elevation") return `${scope}, reordered from highest to lowest.`;
  return `${scope}, reordered by name.`;
}

function destinationMeta(
  sort: AreaDestinationSort,
  elevation: string | null,
  prominence: string | null,
  typeLabel: string | null
): string {
  const values =
    sort === "prominence"
      ? [prominence ? `${prominence} ft prominence` : null, elevation ? `${elevation} ft` : null]
      : [elevation ? `${elevation} ft` : null, prominence ? `${prominence} ft prominence` : null];
  return [...values, typeLabel].filter(Boolean).join(" · ");
}

function countReached(
  destinations: AreaDestination[],
  completions: NonNullable<ReturnType<typeof useAreaPersonalization>["activity"]>["reached_destinations"]
): number {
  return destinations.reduce(
    (count, destination) => count + (completions[destination.id] ? 1 : 0),
    0
  );
}

function MountainPlaceholder() {
  return (
    <svg viewBox="0 0 48 48" className="h-7 w-7 text-muted" aria-hidden="true">
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
