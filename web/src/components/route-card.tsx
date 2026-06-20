import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { DifficultyPill } from "./detail-sections";
import type { SearchRouteResult } from "../lib/actions/search";
import {
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
  summarizeRouteGuide,
} from "../lib/route-guide";

interface RouteCardProps {
  route: SearchRouteResult;
}

export default function RouteCard({ route }: RouteCardProps) {
  const summary = summarizeRouteGuide({ ...route, gain_loss: null });

  return (
    <Card href={`/routes/${route.id}`} className="h-full">
      <div className="text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {route.name || "Unnamed route"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <DifficultyPill label={summary.difficultyLabel} />
        <Badge tone="sky">{describeRouteShape(route.shape)}</Badge>
        <Badge tone="gray">
          {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800">
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
    </Card>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-2 dark:bg-gray-900">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}
