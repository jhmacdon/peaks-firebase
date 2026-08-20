import { StatCluster } from "../ui/stat";

export type ToplineStat = {
  key: string;
  value: string;
  unit?: string;
  label: string;
};

/** The flat metric row under the actions — large Geist Mono numerals on
 * open ground, no cells, no rules, no boxes (design-tokens.md law 2). A
 * stat with nothing behind it isn't listed at all; the caller filters, so
 * a sparse page shows two numbers instead of five dashes. */
export function DestinationTopline({
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
