import Link from "next/link";
import type { ListRow } from "../lib/actions/lists";

interface ListCardProps {
  list: ListRow;
}

export default function ListCard({ list }: ListCardProps) {
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";
  const description =
    list.description || "A public checklist for planning, progress, and route research.";

  return (
    <Link
      href={`/lists/${list.id}`}
      className="group relative block h-full overflow-hidden rounded-[28px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,248,242,0.95))] p-5 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/80 hover:shadow-[0_28px_55px_-34px_rgba(245,158,11,0.28)] dark:border-gray-800 dark:bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))] dark:hover:border-amber-700/70"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(120,113,108,0.10),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(148,163,184,0.10),transparent_24%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:border-amber-900 dark:bg-amber-950/70 dark:text-amber-300">
              {ownerLabel}
            </div>
            <div className="mt-3 text-lg font-semibold leading-tight tracking-tight text-stone-950 transition-colors group-hover:text-amber-800 dark:text-gray-50 dark:group-hover:text-amber-300">
              {list.name}
            </div>
          </div>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-amber-700 shadow-sm transition-transform group-hover:translate-x-0.5 dark:border-gray-700 dark:bg-gray-950/80 dark:text-amber-300">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 11h10" />
              <path d="M9 17h10" />
              <path d="M9 5h10" />
              <path d="m5 6 .5.5L7 5" />
              <path d="m5 12 .5.5L7 11" />
              <path d="m5 18 .5.5L7 17" />
            </svg>
          </span>
        </div>

        <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-600 dark:text-gray-300">
          {description}
        </p>

        <div className="mt-4 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-gray-500">
                Destinations
              </div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-stone-950 dark:text-gray-100">
                {list.destination_count}
              </div>
            </div>
            <p className="max-w-[12rem] text-right text-sm text-stone-500 dark:text-gray-400">
              Track progress and browse every stop in one place.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-stone-200/80 bg-stone-100/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {list.destination_count} destination
            {list.destination_count === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50/90 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/70 dark:text-amber-300">
            Public checklist
          </span>
        </div>
      </div>
    </Link>
  );
}
