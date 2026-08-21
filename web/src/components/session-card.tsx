import type { SessionActivityType } from "../lib/actions/sessions";
import { sessionActivityLabel } from "../lib/session-track";
import { formatFeetValue, formatMilesValue } from "../lib/destination-detail";
import { formatDurationValue } from "../lib/session-detail";
import { ActivityGlyph } from "./session/activity-glyph";
import { Card } from "./ui/card";

interface SessionCardProps {
  id: string;
  name: string | null;
  destinationNames?: string[];
  start_time: string;
  distance: number | null;
  gain: number | null;
  total_time: number | null;
  activity_type?: SessionActivityType | null;
}

/** Derive a display name: explicit name > destinations reached > fallback */
function deriveSessionName(name: string | null, destinationNames?: string[]): string {
  if (name) return name;
  if (destinationNames && destinationNames.length > 0) {
    return destinationNames.join(", ");
  }
  return "Untitled Session";
}

/** One row of the session log. The catalog stores no map thumbnail or
 * polyline for a recorded activity — only the raw points, which are far too
 * heavy to load twenty at a time — so the card leads with the activity glyph
 * instead of the audit's map tile. Title at 17/500, a mono stat row beneath,
 * the date muted. */
export default function SessionCard({
  id,
  name,
  destinationNames,
  start_time,
  distance,
  gain,
  total_time,
  activity_type,
}: SessionCardProps) {
  const date = new Date(start_time);
  const displayName = deriveSessionName(name, destinationNames);
  const stats = [
    { key: "distance", value: formatMilesValue(distance), unit: "mi" },
    { key: "gain", value: formatFeetValue(gain), unit: "ft" },
    { key: "time", value: formatDurationValue(total_time), unit: undefined },
  ].filter((stat): stat is { key: string; value: string; unit?: string } =>
    stat.value !== null
  );

  return (
    <Card href={`/log/${id}`}>
      <div className="flex items-start gap-3">
        <ActivityGlyph
          activityType={activity_type ?? null}
          className="mt-0.5 h-5 w-5 shrink-0 text-muted"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {/* A plain div, not a heading — the same call every other card
                in this app makes, so a list of twenty doesn't bury the page
                H1 under twenty siblings in the outline. */}
            <div className="text-[17px] font-medium leading-snug text-ink">
              {displayName}
            </div>
            <span className="text-[13px] text-muted">
              {date.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="text-[13px] text-muted">
              {sessionActivityLabel(activity_type ?? null)}
            </span>
            {stats.map((stat) => (
              <span
                key={stat.key}
                className="font-mono-num text-[15px] tabular-nums text-ink-2"
              >
                {stat.value}
                {stat.unit ? (
                  <span className="ml-1 text-[0.7em] text-muted">{stat.unit}</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
