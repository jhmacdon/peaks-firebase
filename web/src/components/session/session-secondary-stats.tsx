import type { SessionStat } from "../../lib/session-detail";

/** The smaller grid under the topline: 12px muted labels over Geist Mono
 * values, flat ground, no cells (design-tokens.md law 2). A size down from
 * the topline rather than a different shape — same value-over-label
 * language, so the page reads as one system at two altitudes.
 *
 * Not a StatCluster: this row inverts the order, printing the label first,
 * which is what lets six of them sit in a tight grid without the numerals
 * fighting the topline above. */
export function SessionSecondaryStats({
  stats,
  className = "",
}: {
  stats: SessionStat[];
  className?: string;
}) {
  if (stats.length === 0) return null;

  return (
    // Capped rather than full-bleed: three cells stretched across a 1200px
    // page read as three unrelated facts. Held to a 2x3 block they read as
    // one grid, which is what the audit's `.more-stats` panel does.
    <dl
      className={`grid max-w-[560px] grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 ${className}`.trim()}
    >
      {stats.map((stat) => (
        <div key={stat.key}>
          <dt className="text-[12px] text-muted">{stat.label}</dt>
          <dd className="mt-0.5 font-mono-num text-[17px] tabular-nums leading-none text-ink">
            {stat.value}
            {stat.unit ? (
              <span className="ml-1 text-[0.65em] text-ink-2">{stat.unit}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
