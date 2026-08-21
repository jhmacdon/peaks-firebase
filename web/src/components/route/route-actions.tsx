import { Button } from "../ui/button";

/** Directions to the start — the route page's one filled action
 * (design-tokens.md law 4). */
export function RouteActions({
  directionsUrl,
  className = "",
}: {
  directionsUrl: string | null;
  className?: string;
}) {
  if (!directionsUrl) return null;

  return (
    <div className={`flex flex-wrap items-start gap-3 ${className}`.trim()}>
      <Button href={directionsUrl} external>
        Directions to start
      </Button>
    </div>
  );
}
