import Link from "next/link";
import { Badge } from "./ui/badge";
import { FireLookoutBadge } from "./fire-lookout-badge";
import { CatalogMedia } from "./catalog-media";
import SaveDestinationButton from "./save-destination-button";
import { formatDistanceAway, formatFeetValue } from "../lib/destination-detail";

interface DestinationCardProps {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  distance_m?: number;
  imageUrl?: string | null;
  imageAttribution?: string | null;
  imageAttributionUrl?: string | null;
  imageFocalX?: number;
  imageFocalY?: number;
  location?: string | null;
  locationLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export default function DestinationCard({ id, name, elevation, features, distance_m, imageUrl, imageAttribution, imageAttributionUrl, imageFocalX, imageFocalY, location, locationLabel, lat, lng }: DestinationCardProps) {
  const primaryFeature = features.includes("fire-lookout") ? "fire-lookout" : features[0] ?? null;
  const overflowFeatureCount = primaryFeature ? features.length - 1 : 0;
  const elevationLabel = formatFeetValue(elevation);
  const meta = [elevationLabel ? `${elevationLabel} ft elevation` : null, distance_m == null ? null : formatDistanceAway(distance_m)].filter(Boolean).join(" · ");
  return (
    <article className="group relative h-full overflow-hidden rounded-media border border-border bg-page transition-colors hover:border-muted">
      <Link href={`/destinations/${id}`} prefetch={false} className="block">
        <CatalogMedia src={imageUrl} focalX={imageFocalX} focalY={imageFocalY} lat={lat} lng={lng} />
        <div className="p-4">
          <h3 className="text-lg font-semibold leading-snug text-ink">{name || "Unnamed place"}</h3>
          {(locationLabel || location) && <p className="mt-1 text-sm text-muted">{locationLabel || location}</p>}
          {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
          {primaryFeature && <div className="mt-3 flex flex-wrap gap-1.5">{primaryFeature === "fire-lookout" ? <FireLookoutBadge /> : <Badge tone="gray">{primaryFeature}</Badge>}{overflowFeatureCount > 0 && <Badge tone="gray">+{overflowFeatureCount}</Badge>}</div>}
        </div>
      </Link>
      {imageUrl && imageAttribution && <p className="px-4 pb-3 text-xs leading-relaxed text-muted">Photo: {imageAttributionUrl ? <a href={imageAttributionUrl} target="_blank" rel="noopener noreferrer" className="underline">{imageAttribution}</a> : imageAttribution}</p>}
      <div className="absolute right-3 top-3"><SaveDestinationButton destinationId={id} name={name} compact /></div>
    </article>
  );
}
