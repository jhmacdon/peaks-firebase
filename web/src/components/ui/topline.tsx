import { StatCluster } from "./stat";

export type ToplineStat = {
  key: string;
  value: string;
  unit?: string;
  label: string;
};

/** The flat metric row under a page's actions — large Geist Mono numerals on
 * open ground, no cells, no rules, no boxes (design-tokens.md law 2). A
 * stat with nothing behind it isn't listed at all; the caller filters, so
 * a sparse page shows two numbers instead of five dashes.
 *
 * Lived at components/destination/destination-topline.tsx until Task 17.
 * By then the destination, route, area, list and activity pages all drew
 * the same row, so the shape moved in with the other shared atoms and lost
 * the one page's name. */
export function Topline({
  stats,
  className = "",
}: {
  stats: ToplineStat[];
  className?: string;
}) {
  if (stats.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-x-12 gap-y-6 ${className}`.trim()}>
      {stats.map((stat) => (
        <StatCluster
          key={stat.key}
          scale="topline"
          value={stat.value}
          unit={stat.unit}
          label={stat.label}
        />
      ))}
    </div>
  );
}
