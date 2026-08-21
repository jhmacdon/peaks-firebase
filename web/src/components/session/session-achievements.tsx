import Link from "next/link";
import type { SessionAchievement } from "../../lib/session-detail";
import { TrophyGlyph } from "./activity-glyph";

/** One line per destination reached — "Reached Camp Muir · 10:42 AM" — not a
 * badge shelf. The audit's cheapest and best social pattern (§7.4): a line
 * costs 12px of height and carries the whole moment. The name is the only
 * accent-text on the row; the trophy and the time stay muted.
 *
 * The time is derived from the nearest recorded track point, so it is
 * missing whenever the track never passed close enough — in which case the
 * line simply reads "Reached Camp Muir". */
export function SessionAchievements({
  achievements,
  className = "",
}: {
  achievements: SessionAchievement[];
  className?: string;
}) {
  if (achievements.length === 0) return null;

  return (
    <section className={className} aria-label="Destinations reached">
      <ul className="space-y-2">
        {achievements.map((achievement) => (
          <li key={achievement.id} className="flex items-center gap-2 text-sm">
            <TrophyGlyph className="h-4 w-4 shrink-0 text-muted" />
            <span className="text-ink-2">
              Reached{" "}
              <Link
                href={`/destinations/${achievement.id}`}
                className="font-medium text-accent-text hover:underline"
              >
                {achievement.name}
              </Link>
              {achievement.reachedAt != null ? (
                <span className="text-muted">
                  {" · "}
                  {formatTimeOfDay(achievement.reachedAt)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "10:42 AM" in the reader's own time zone. Deliberately not in
 * lib/session-detail.ts: the value there is an epoch second, which is the
 * testable part; the wall-clock rendering belongs where the reader's locale
 * lives. */
function formatTimeOfDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
