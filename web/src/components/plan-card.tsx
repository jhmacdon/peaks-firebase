import Link from "next/link";
import { CatalogMedia } from "./catalog-media";
import type { PlanPreview } from "../lib/actions/plans";
import { isExternalHref } from "../lib/url-utils";
import { myRoutePath } from "./route-paths";

interface PlanCardProps {
  id: string;
  name: string;
  date: string | null;
  destinationCount: number;
  partySize: number;
  isPublic?: boolean;
  description?: string;
  preview?: PlanPreview;
}

export default function PlanCard({
  id,
  name,
  date,
  destinationCount,
  partySize,
  isPublic = false,
  description,
  preview,
}: PlanCardProps) {
  return (
    <article className="group overflow-hidden rounded-media border border-border bg-page">
    <Link href={myRoutePath(id)} className="block">
      <CatalogMedia src={preview?.imageUrl} lat={preview?.lat} lng={preview?.lng} kind="Trip" />
      <div className="p-5">
      <p className="mb-3 text-xs text-muted">{isPublic ? "Public trip" : "Private trip"}</p>
      <div className="text-lg font-medium text-ink">{name || "Untitled trip"}</div>
      {preview?.location && <p className="mt-1 text-sm text-muted">{preview.location}</p>}
      {(preview?.distance != null || preview?.gain != null) && <div className="mt-3"><p className="text-sm text-ink-2">{[preview.distance != null ? `${(preview.distance / 1609.34).toFixed(1)} mi` : null, preview.gain != null ? `${Math.round(preview.gain * 3.28084).toLocaleString()} ft gain` : null].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-muted">Route totals · routes may overlap</p></div>}
      {date && (
        <div className="text-sm text-muted mt-1">
          {new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )}
      {description && <p className="mt-2 line-clamp-2 text-sm text-muted">{description}</p>}
      <div className="flex flex-wrap gap-3 mt-3 text-sm text-ink-2">
        <span>
          {destinationCount} destination{destinationCount !== 1 ? "s" : ""}
        </span>
        {partySize > 0 && (
          <>
            <span>·</span>
            <span>
              {partySize + 1} member{partySize > 0 ? "s" : ""}
            </span>
          </>
        )}
      </div>
      </div>
    </Link>
    {preview?.imageUrl && preview.imageAttribution && <p className="px-5 pb-4 text-xs text-muted">Photo: {preview.imageAttributionUrl && isExternalHref(preview.imageAttributionUrl) ? <a href={preview.imageAttributionUrl} target="_blank" rel="noopener noreferrer" className="underline">{preview.imageAttribution}</a> : preview.imageAttribution}</p>}
    </article>
  );
}
