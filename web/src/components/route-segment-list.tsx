import type { RouteSegment } from "../lib/actions/routes";
import {
  formatDistanceMeters,
  formatElevationMeters,
  summarizeSegments,
} from "../lib/route-guide";

interface RouteSegmentListProps {
  segments: RouteSegment[];
}

export default function RouteSegmentList({ segments }: RouteSegmentListProps) {
  const summary = summarizeSegments(segments);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
          {summary.count} segment{summary.count === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
          {summary.sharedCount} shared
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
          {summary.reverseCount} reverse
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
          {summary.totalDistanceMiles.toFixed(1)} mi of segment geometry
        </span>
      </div>

      <div className="space-y-3">
        {segments.map((segment) => {
          const usageLabel =
            segment.route_count > 1
              ? `Shared by ${segment.route_count} routes`
              : "Unique to this route";

          return (
            <div
              key={segment.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-950/40 dark:hover:border-blue-700"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-sm">
                    {segment.name || `Segment ${segment.ordinal + 1}`}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {segment.direction === "reverse" ? "Reverse" : "Forward"} direction
                    {" · "}
                    {formatDistanceMeters(segment.distance)}
                    {" · "}
                    {formatElevationMeters(segment.gain)} gain
                    {segment.gain_loss != null && (
                      <>
                        {" · "}
                        {formatElevationMeters(segment.gain_loss)} loss
                      </>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                  {usageLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
