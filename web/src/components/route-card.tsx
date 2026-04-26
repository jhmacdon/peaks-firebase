import Link from "next/link";
import type { SearchRouteResult } from "../lib/actions/search";
import {
  describeCompletionMode,
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
  summarizeRouteGuide,
} from "../lib/route-guide";

interface RouteCardProps {
  route: SearchRouteResult;
}

export default function RouteCard({ route }: RouteCardProps) {
  const summary = summarizeRouteGuide({
    ...route,
    gain_loss: null,
  });
  const completionLabel =
    route.completion === "straight"
      ? "Best forward"
      : route.completion === "reverse"
        ? "Best in reverse"
        : describeCompletionMode(route.completion);

  return (
    <Link
      href={`/routes/${route.id}`}
      className="group relative block h-full overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,250,0.96))] p-5 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-300/80 hover:shadow-[0_28px_55px_-34px_rgba(14,165,233,0.35)] dark:border-gray-800 dark:bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))] dark:hover:border-sky-700/70"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.10),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.12),transparent_24%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-sky-200/80 bg-sky-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800 dark:border-sky-900 dark:bg-sky-950/70 dark:text-sky-300">
              Route guide
            </div>
            <div className="mt-3 text-lg font-semibold leading-tight tracking-tight text-stone-950 transition-colors group-hover:text-sky-800 dark:text-gray-50 dark:group-hover:text-sky-300">
              {route.name || "Unnamed route"}
            </div>
          </div>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-slate-500 shadow-sm transition-all group-hover:translate-x-0.5 group-hover:text-sky-700 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-400 dark:group-hover:text-sky-300">
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
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium">
          <span className={difficultyBadgeClass(summary.difficultyLabel)}>
            {summary.difficultyLabel}
          </span>
          <span className="rounded-full border border-slate-200/80 bg-slate-100/90 px-2.5 py-1 text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {describeRouteShape(route.shape)}
          </span>
          <span className="rounded-full border border-slate-200/80 bg-slate-100/90 px-2.5 py-1 text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <RouteMetric label="Distance" value={formatDistanceMeters(route.distance)} />
          <RouteMetric label="Gain" value={formatElevationMeters(route.gain)} />
          <RouteMetric
            label="Beta"
            value={
              route.session_count === 0
                ? "New"
                : `${route.session_count} log${route.session_count === 1 ? "" : "s"}`
            }
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-stone-500 dark:text-gray-400">
          <span className="min-w-0 truncate">{completionLabel}</span>
          <span className="shrink-0 font-medium text-stone-700 dark:text-gray-200">
            {route.session_count} recorded outing{route.session_count === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function RouteMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 px-3 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-stone-950 dark:text-gray-100">
        {value}
      </div>
    </div>
  );
}

function difficultyBadgeClass(label: string): string {
  switch (label) {
    case "Easy":
      return "rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-1 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300";
    case "Moderate":
      return "rounded-full border border-sky-200/80 bg-sky-50/90 px-2.5 py-1 text-sky-800 dark:border-sky-900 dark:bg-sky-950/70 dark:text-sky-300";
    case "Hard":
      return "rounded-full border border-amber-200/80 bg-amber-50/90 px-2.5 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950/70 dark:text-amber-300";
    default:
      return "rounded-full border border-orange-200/80 bg-orange-50/90 px-2.5 py-1 text-orange-800 dark:border-orange-900 dark:bg-orange-950/70 dark:text-orange-300";
  }
}
