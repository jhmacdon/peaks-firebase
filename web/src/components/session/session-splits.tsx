"use client";

import { useState } from "react";
import type { SessionSplit } from "../../lib/session-detail";
import { SectionHeading } from "../ui/section-heading";
import { Button } from "../ui/button";

const VISIBLE_BY_DEFAULT = 12;

/** Per-mile splits: mile number, pace, and the elevation the mile cost or
 * gave back, with a pale bar behind each pace so the shape of the day reads
 * before any single number does (audit §5.5 — encode magnitude with area).
 *
 * Hairline-divided rows inside one section, not a bordered table: rows
 * inside a section separate by a hairline, sections by whitespace
 * (design-tokens.md law 3). A long day can run to forty miles, so only the
 * first twelve show until asked. */
export function SessionSplits({
  splits,
  className = "",
}: {
  splits: SessionSplit[];
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);

  // One split is just the activity's own pace restated.
  if (splits.length < 2) return null;

  const slowest = splits.reduce(
    (worst, split) => Math.max(worst, split.secondsPerMile),
    0
  );
  const shown = showAll ? splits : splits.slice(0, VISIBLE_BY_DEFAULT);
  const hasElevation = splits.some((split) => split.changeMeters != null);

  return (
    <section className={className} aria-labelledby="session-splits">
      <SectionHeading>
        <span id="session-splits">Splits</span>
      </SectionHeading>

      <table className="mt-4 w-full max-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-[12px] text-muted">
            <th scope="col" className="w-12 pb-2 font-normal">
              Mile
            </th>
            <th scope="col" className="pb-2 font-normal">
              Pace
            </th>
            {hasElevation ? (
              <th scope="col" className="w-24 pb-2 text-right font-normal">
                Elevation
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((split) => (
            <tr key={split.mile} className="border-b border-hairline">
              <td className="py-2 font-mono-num tabular-nums text-[13px] text-muted">
                {/* A whole mile is numbered; the partial tail is labelled
                    with the distance it ends at, so the last row matches the
                    activity's own total. */}
                {split.fraction < 0.95
                  ? (split.mile - 1 + split.fraction).toFixed(1)
                  : split.mile}
              </td>
              <td className="py-2">
                <span className="flex items-center gap-3">
                  {/* The bar lives in its own elastic track so a slow mile
                      at full width can't push the pace into the elevation
                      column. Ink-at-15% is the same context grey the
                      elevation chart fills with. */}
                  <span aria-hidden="true" className="h-1.5 min-w-0 flex-1">
                    <span
                      className="block h-full rounded-full bg-ink/15"
                      style={{
                        width: `${
                          slowest > 0
                            ? Math.max(4, (split.secondsPerMile / slowest) * 100)
                            : 4
                        }%`,
                      }}
                    />
                  </span>
                  <span className="w-[72px] shrink-0 text-right font-mono-num tabular-nums text-ink-2">
                    {formatPace(split.secondsPerMile)}
                  </span>
                </span>
              </td>
              {hasElevation ? (
                <td className="py-2 text-right font-mono-num tabular-nums text-ink-2">
                  {formatChange(split.changeMeters)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {splits.length > VISIBLE_BY_DEFAULT && !showAll ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setShowAll(true)}
        >
          Show all {splits.length} splits
        </Button>
      ) : null}
    </section>
  );
}

/** "25:53" — minutes and seconds for a mile. Hours appear only on a genuine
 * crawl, where "1:04:10" is more honest than "64:10". */
function formatPace(secondsPerMile: number): string {
  const safe = Math.max(0, Math.round(secondsPerMile));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const paddedSeconds = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/** "+512 ft" / "−318 ft" / "—". A true minus sign, not a hyphen. */
function formatChange(meters: number | null): string {
  if (meters == null) return "—";
  const feet = Math.round(meters * 3.28084);
  if (feet === 0) return "0 ft";
  return `${feet > 0 ? "+" : "−"}${Math.abs(feet).toLocaleString("en-US")} ft`;
}
