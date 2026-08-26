import { Button } from "../ui/button";
import SaveDestinationButton from "../save-destination-button";
import { ShareLinkButton } from "../share-link-button";

/** Save (the one filled primary) · Directions · Report conditions.
 * Directions and the report link only ever get a neutral fill or plain
 * accent text — the accent budget allows a single filled action per
 * surface. */
export function DestinationActions({
  destinationId,
  name,
  directionsUrl,
  className = "",
}: {
  destinationId: string;
  name: string | null;
  directionsUrl: string | null;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-3 ${className}`.trim()}>
      <SaveDestinationButton destinationId={destinationId} name={name} />
      {directionsUrl ? (
        <Button href={directionsUrl} variant="secondary" external>
          Directions
        </Button>
      ) : null}
      <Button href={`/reports/new?dest=${destinationId}`} variant="quiet">
        Report conditions
      </Button>
      <ShareLinkButton
        url={`/destinations/${encodeURIComponent(destinationId)}`}
        title={name || "Peaks destination"}
      />
    </div>
  );
}
