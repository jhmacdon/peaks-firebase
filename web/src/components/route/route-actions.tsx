import { Button } from "../ui/button";
import { ShareLinkButton } from "../share-link-button";
import { catalogRoutePath } from "../route-paths";

/** Directions to the start — the route page's one filled action
 * (design-tokens.md law 4). */
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
      {directionsUrl ? (
        <Button href={directionsUrl} external>
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
