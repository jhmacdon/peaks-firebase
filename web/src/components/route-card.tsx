import Link from "next/link";
import type { SearchRouteResult } from "../lib/actions/search";
import {
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
} from "../lib/route-guide";

interface RouteCardProps {
  route: SearchRouteResult;
}

export default function RouteCard({ route }: RouteCardProps) {
  return (
    <Link
      href={`/routes/${route.id}`}
      className="group block rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight text-gray-950 transition-colors group-hover:text-blue-700 dark:text-gray-50 dark:group-hover:text-blue-300">
            {route.name || "Unnamed route"}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800">
              {describeRouteShape(route.shape)}
            </span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800">
              {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800">
              {route.session_count} session{route.session_count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
          View
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-300">
        <span>{formatDistanceMeters(route.distance)}</span>
        <span>&middot;</span>
        <span>{formatElevationMeters(route.gain)} gain</span>
      </div>
    </Link>
  );
}
