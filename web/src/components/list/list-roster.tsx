"use client";

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
  const { entries } = useListCompletion();
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
            <p className="mt-2 text-[12px] text-muted">
              Reach any {effectiveTarget.toLocaleString("en-US")} of the{" "}
              {memberCount.toLocaleString("en-US")} destinations to complete this list.
              {completedCount > effectiveTarget
                ? ` ${completedCount.toLocaleString("en-US")} reached.`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">This list has no destinations yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {destinations.map((destination) => {
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
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill">
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
                      <span className="mt-0.5 block text-[12px] text-muted">
                        {elevation ? (
                          <span className="font-mono-num tabular-nums">{elevation} ft</span>
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
