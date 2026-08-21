"use client";

import Link from "next/link";
import type { ListDestination } from "../../lib/actions/lists";
import { formatFeetValue, formatShortDate, titleize } from "../../lib/destination-detail";
import { TrophyGlyph } from "../session/activity-glyph";
import ProgressBar from "../progress-bar";
import { SectionHeading } from "../ui/section-heading";
import { useListCompletion } from "./list-completion-context";

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
  className = "",
}: {
  destinations: ListDestination[];
  className?: string;
}) {
  const { entries } = useListCompletion();

  return (
    <section className={className} aria-labelledby="list-destinations">
      <SectionHeading>
        <span id="list-destinations">
          Destinations{destinations.length > 0 ? ` (${destinations.length})` : ""}
        </span>
      </SectionHeading>

      {entries && destinations.length > 0 ? (
        <ProgressBar
          completed={Object.keys(entries).length}
          total={destinations.length}
          className="mt-4 max-w-sm"
        />
      ) : null}

      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">This list has no destinations yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {destinations.map((destination) => {
            const elevation = formatFeetValue(destination.elevation);
            const featureWord = destination.features[0] ? titleize(destination.features[0]) : null;
            const completion = entries?.[destination.id] ?? null;

            return (
              <li key={destination.id}>
                <Link
                  href={`/destinations/${destination.id}`}
                  className="group flex items-center gap-3"
                >
                  {destination.hero_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={destination.hero_image}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full bg-fill object-cover"
                      style={{
                        objectPosition: `${destination.hero_image_focal_x}% ${destination.hero_image_focal_y}%`,
                      }}
                    />
                  ) : null}
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
    </section>
  );
}
