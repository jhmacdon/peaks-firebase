import Link from "next/link";
import { CatalogMedia } from "./catalog-media";
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
  locationLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
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
export default function RouteCard({ route, locationLabel, lat, lng }: RouteCardProps) {
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

  const content = (
    <>
      <div className="text-lg font-semibold leading-snug text-ink">
        {route.name || "Unnamed route"}
      </div>
      {locationLabel && <p className="mt-1 text-sm text-muted">{locationLabel}</p>}
      <div className="mt-1 text-sm text-muted">{meta}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {summary.difficultyLabel ? <Badge>{summary.difficultyLabel}</Badge> : null}
        {shapeLabel ? <Badge>{shapeLabel}</Badge> : null}
        <Badge>
          {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
        </Badge>
      </div>
    </>
  );

  const hasCreditedCover =
    route.cover_image &&
    route.cover_image_attribution &&
    route.cover_image_attribution_url;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-media border border-border bg-page transition-colors hover:bg-fill">
      <Link
        href={`/routes/${route.id}`}
        prefetch={false}
        className="group block flex-1"
      >
        <CatalogMedia src={hasCreditedCover ? route.cover_image : null} focalX={route.cover_image_focal_x} focalY={route.cover_image_focal_y} kind="Route guide" lat={lat} lng={lng} />
        <div className="p-4">{content}</div>
      </Link>
      {hasCreditedCover && <div className="px-4 pb-3 text-xs leading-snug text-muted">
        Photo:{" "}
        <a
          href={route.cover_image_attribution_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {route.cover_image_attribution}
        </a>{" "}
        · cropped
      </div>}
    </article>
  );
}
