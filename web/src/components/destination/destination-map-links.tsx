import { formatCoordinates } from "../../lib/format";
import { getDestinationMapLinks } from "../../lib/destination-detail";
import { CopyCoordinates } from "./copy-coordinates";

/** Coordinates, once per page (Task 1's rule), with the two external map
 * links beside them. Flat row, no box — it belongs to the map above it. */
export function DestinationMapLinks({
  lat,
  lng,
  className = "",
}: {
  lat: number;
  lng: number;
  className?: string;
}) {
  const coordText = formatCoordinates(lat, lng);
  const links = getDestinationMapLinks(lat, lng);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] ${className}`.trim()}
    >
      {coordText ? (
        <span className="flex items-center gap-3">
          <span className="font-mono-num text-ink-2">{coordText}</span>
          <CopyCoordinates text={coordText} />
        </span>
      ) : null}
      <a
        href={links.openStreetMap}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-text hover:underline"
      >
        OpenStreetMap
      </a>
      <a
        href={links.googleMaps}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-text hover:underline"
      >
        Google Maps
      </a>
    </div>
  );
}
