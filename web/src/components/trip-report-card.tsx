import Link from "next/link";
import type { TripReport } from "../lib/actions/trip-reports";

interface TripReportCardProps {
  report: TripReport;
}

export default function TripReportCard({ report }: TripReportCardProps) {
  const date = new Date(report.date);
  const photoCount = report.blocks.filter((block) => block.type === "photo").length;
  const destinationCount = report.destinations.length;

  // Find first text block for preview
  const firstTextBlock = report.blocks.find((b) => b.type === "text");
  const preview = firstTextBlock?.content
    ? firstTextBlock.content.length > 200
      ? firstTextBlock.content.slice(0, 200) + "..."
      : firstTextBlock.content
    : null;

  return (
    <Link
      href={`/reports/${report.id}`}
      className="group relative block h-full overflow-hidden rounded-[28px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,247,245,0.95))] p-5 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_28px_55px_-34px_rgba(14,165,233,0.25)] dark:border-gray-800 dark:bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))] dark:hover:border-slate-700"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(120,113,108,0.10),transparent_22%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(148,163,184,0.08),transparent_22%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-stone-200/80 bg-stone-100/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              Field report
            </div>
            <div className="mt-3 text-lg font-semibold leading-tight tracking-tight text-stone-950 transition-colors group-hover:text-sky-800 dark:text-gray-50 dark:group-hover:text-sky-300">
              {report.title}
            </div>
          </div>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-stone-500 shadow-sm transition-all group-hover:translate-x-0.5 group-hover:text-sky-700 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-400 dark:group-hover:text-sky-300">
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

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-stone-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-300">
            {report.userName}
          </span>
          <span className="inline-flex items-center rounded-full border border-stone-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-300">
            {date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        {preview ? (
          <p className="mt-4 line-clamp-4 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm leading-6 text-stone-600 shadow-sm dark:border-gray-800 dark:bg-gray-950/70 dark:text-gray-300">
            {preview}
          </p>
        ) : (
          <p className="mt-4 text-sm text-stone-500 dark:text-gray-400">
            Community field notes, photos, and recent conditions.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-100/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {destinationCount} destination{destinationCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-sky-50/90 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/70 dark:text-sky-300">
            {photoCount} photo{photoCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center rounded-full border border-stone-200/80 bg-stone-100/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {report.blocks.length} block{report.blocks.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}
