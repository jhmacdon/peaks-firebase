import Link from "next/link";
import { areaKindLabel, type ProtectedArea } from "../lib/area-types";
import type { AreaCoverPhoto } from "../lib/area-cover-photo";
import { subdivisionName } from "../lib/regions";
import { CatalogMedia } from "./catalog-media";

export interface AreaCardData extends ProtectedArea {
  state_codes?: string[];
  destination_count?: number;
  route_count?: number;
  cover_photo?: AreaCoverPhoto | null;
}
export function AreaCard({ area, typeLabel, lat, lng }: { area: AreaCardData; typeLabel?: string; lat?: number | null; lng?: number | null }) {
  const location = area.state_codes?.map((code) => subdivisionName("US", code) || code).join(", ");
  const facts = [area.destination_count == null ? null : `${area.destination_count.toLocaleString("en-US")} places`, area.route_count == null ? null : `${area.route_count.toLocaleString("en-US")} routes`].filter(Boolean);
  const photo = area.cover_photo;
  return (
    <article className="group h-full overflow-hidden rounded-media border border-border bg-page transition-colors hover:border-muted">
      <Link href={`/areas/${encodeURIComponent(area.id)}`} prefetch={false} className="block">
        <CatalogMedia src={photo?.imageUrl} focalX={photo?.focalX} focalY={photo?.focalY} kind="Area guide" lat={lat} lng={lng} />
        <div className="p-4">
          <h3 className="text-lg font-semibold leading-snug text-ink">{area.name}</h3>
          <p className="mt-1 text-sm text-muted">{[typeLabel ?? areaKindLabel(area.kind), location].filter(Boolean).join(" · ")}</p>
          {facts.length > 0 && <p className="mt-2 text-sm text-muted">{facts.join(" · ")}</p>}
        </div>
      </Link>
      {photo?.attribution && <p className="px-4 pb-3 text-xs leading-relaxed text-muted">Photo: {photo.attributionUrl ? <a href={photo.attributionUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.attribution}</a> : photo.attribution}</p>}
    </article>
  );
}
export default AreaCard;
