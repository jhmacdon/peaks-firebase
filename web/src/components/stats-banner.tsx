interface StatItem {
  label: string;
  value: string;
}

interface StatsBannerProps {
  eyebrow?: string;
  primary: StatItem;
  context: string;
  stats: StatItem[];
}

export default function StatsBanner({
  eyebrow = "Lifetime activity",
  primary,
  context,
  stats,
}: StatsBannerProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-400">
            {eyebrow}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {primary.value}
            </span>
            <span className="font-semibold text-gray-600 dark:text-gray-300">
              {primary.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {context}
          </p>
        </div>

        <div
          className={`grid min-w-full gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 sm:min-w-[520px] ${
            stats.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"
          }`}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white px-3 py-2.5 dark:bg-gray-900"
            >
              <div className="text-sm font-semibold tabular-nums">
                {stat.value}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
