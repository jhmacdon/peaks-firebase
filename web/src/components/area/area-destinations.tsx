"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAreaDestinationPage, type AreaDestination } from "../../lib/actions/areas";
import { useAuth } from "../../lib/auth-context";
import {
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

export function AreaDestinations({
  areaId,
  destinations: initialDestinations,
  totalCount,
  className = "",
}: {
  areaId: string;
  destinations: AreaDestination[];
  totalCount: number;
  className?: string;
}) {
  const { activity, signedIn } = useAreaPersonalization();
  const { getIdToken } = useAuth();
  const [sort, setSort] = useState<AreaDestinationSort>("prominence");
  const [filter, setFilter] = useState<CompletionFilter>("all");
  const [query, setQuery] = useState("");
  const [destinations, setDestinations] = useState(initialDestinations.slice(0, 24));
  const [total, setTotal] = useState(totalCount);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const completions = activity?.reached_destinations ?? null;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const token = filter === "all" ? undefined : await getIdToken() ?? undefined;
        const page = await getAreaDestinationPage(areaId, { offset, sort, query, completion: filter, token });
        if (!cancelled) { setDestinations(page.destinations); setTotal(page.total); }
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [areaId, offset, sort, query, filter, getIdToken, attempt]);
  const sorted = destinations;
  const filtered = sorted;
  const visible = filtered;
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
            {total.toLocaleString()} catalog places. Search, sort, and filter the full area.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as AreaDestinationSort);
              setOffset(0);
            }}
            className="h-11 rounded-ctl border border-border bg-page px-3 text-[13px] text-ink"
          >
            <option value="prominence">Prominence</option>
            <option value="elevation">Elevation</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      <label className="mt-5 block text-sm text-muted">
        Search this area
        <input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Peak or place name" className="mt-2 h-11 w-full rounded-ctl border border-border bg-page px-3 text-base text-ink" />
      </label>
      {error ? <p role="alert" className="mt-4 text-sm text-alert">Places could not load. <Button variant="quiet" onClick={() => setAttempt((value) => value + 1)}>Retry</Button></p> : null}
      {loading ? <p role="status" className="mt-4 text-sm text-muted">Loading places…</p> : null}
      {signedIn && completions ? (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Filter destinations">
          <Chip
            selected={filter === "all"}
            onClick={() => {
              setFilter("all");
              setOffset(0);
            }}
          >
            All
          </Chip>
          <Chip
            selected={filter === "reached"}
            onClick={() => {
              setFilter("reached");
              setOffset(0);
            }}
          >
            Reached
          </Chip>
          <Chip
            selected={filter === "open"}
            onClick={() => {
              setFilter("open");
              setOffset(0);
            }}
          >
            Not yet
          </Chip>
        </div>
      ) : null}

      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No places match your search. Try a shorter name or another filter.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No destinations match this filter.</p>
      ) : (
        <ol className="mt-6 grid gap-x-10 gap-y-5 md:grid-cols-2">
          {visible.map((destination) => {
            const rank = offset + sorted.findIndex((item) => item.id === destination.id) + 1;
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

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>Previous</Button>
        <span className="text-sm text-muted">{total ? `${offset + 1}–${Math.min(offset + destinations.length, total)} of ${total.toLocaleString()}` : "0 places"}</span>
        <Button variant="secondary" disabled={loading || offset + 24 >= total} onClick={() => setOffset(offset + 24)}>Next</Button>
      </div>

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
