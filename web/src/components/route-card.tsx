import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { SearchRouteResult } from "../lib/actions/search";
import {
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
  getRouteTraversalMetrics,
  summarizeRouteGuide,
} from "../lib/route-guide";
import { formatSessionCount } from "../lib/format";

interface RouteCardProps {
  route: SearchRouteResult;
}

// Same shape as DestinationCard: title, one muted meta line, one badge row.
//
// The bordered three-cell metric grid this card used to carry was a box
// inside a box AND a boxed stat (design-tokens.md laws 1 and 2); the numbers
// read fine on flat ground.
//
// The numbers themselves come from getRouteTraversalMetrics, the same helper
// the route page uses — so an out-and-back route quotes its round trip here
// and on its own page, rather than one-way here and round-trip there.
export default function RouteCard({ route }: RouteCardProps) {
  const summary = summarizeRouteGuide(route);
  const traversal = getRouteTraversalMetrics(route);
  const shapeLabel = describeRouteShape(route.shape);

  const meta = [
    traversal.distanceMeters != null
      ? formatDistanceMeters(traversal.distanceMeters)
      : null,
    traversal.gainMeters != null
      ? `${formatElevationMeters(traversal.gainMeters)} gain`
      : null,
    route.session_count === 0 ? "New" : formatSessionCount(route.session_count),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <Card href={`/routes/${route.id}`} className="h-full">
      <div className="text-base font-medium leading-tight text-ink">
        {route.name || "Unnamed route"}
      </div>
      <div className="mt-1 text-sm text-muted">{meta}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {summary.difficultyLabel ? <Badge>{summary.difficultyLabel}</Badge> : null}
        {shapeLabel ? <Badge>{shapeLabel}</Badge> : null}
        <Badge>
          {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
        </Badge>
      </div>
    </Card>
  );
}
