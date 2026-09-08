import { Button } from "../ui/button";
import { ShareLinkButton } from "../share-link-button";
import { catalogRoutePath } from "../route-paths";

/** Keep the catalog route selected through sign-in and trip creation. */
export function RouteActions({
  routeId,
  name,
  directionsUrl,
  className = "",
}: {
  routeId: string;
  name: string;
  directionsUrl: string | null;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-3 ${className}`.trim()}>
      <Button href={`/my-routes/new?route=${encodeURIComponent(routeId)}&name=${encodeURIComponent(name)}`}>
        Plan a trip
      </Button>
      {directionsUrl ? (
        <Button href={directionsUrl} variant="secondary" external>
          Directions to start
        </Button>
      ) : null}
      <ShareLinkButton
        url={catalogRoutePath(routeId)}
        title={name}
      />
    </div>
  );
}
