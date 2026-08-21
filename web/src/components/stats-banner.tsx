import { StatCluster } from "./ui/stat";

interface StatItem {
  label: string;
  value: string;
  unit?: string;
}

interface StatsBannerProps {
  eyebrow?: string;
  primary: StatItem;
  context: string;
  stats: StatItem[];
}

/** The lifetime block at the top of the session log: an eyebrow, then one
 * flat row of page-scale StatClusters, then a sentence of context.
 *
 * Used to be a bordered card wrapped around a bordered grid of bordered
 * cells — a box inside a box inside a box, and every numeral in one
 * (design-tokens.md laws 1 and 2). Now the numbers stand on open ground and
 * the row separates from what follows by whitespace, not a rule.
 */
export default function StatsBanner({
  eyebrow = "Lifetime activity",
  primary,
  context,
  stats,
}: StatsBannerProps) {
  return (
    <section aria-label={eyebrow}>
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
        {eyebrow}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-12 gap-y-6">
        <StatCluster
          scale="page"
          value={primary.value}
          unit={primary.unit}
          label={primary.label}
        />
        {stats.map((stat) => (
          <StatCluster
            key={stat.label}
            scale="page"
            value={stat.value}
            unit={stat.unit}
            label={stat.label}
          />
        ))}
      </div>
      <p className="mt-5 text-sm text-muted">{context}</p>
    </section>
  );
}
