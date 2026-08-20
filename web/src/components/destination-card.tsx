import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { formatDistanceAway, formatFeetValue } from "../lib/destination-detail";

interface DestinationCardProps {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  distance_m?: number;
}

export default function DestinationCard({
  id,
  name,
  elevation,
  features,
  distance_m,
}: DestinationCardProps) {
  // One primary chip plus an overflow count — never two rows of chips.
  const primaryFeature = features[0] ?? null;
  const overflowFeatureCount = primaryFeature ? features.length - 1 : 0;
  // formatFeetValue pins its own "en-US" locale (a bare .toLocaleString()
  // seeds from the runtime locale, which can differ between the server
  // render and the browser and trip a hydration mismatch) and returns null
  // rather than a placeholder — nothing to filter out below when the
  // catalog has no elevation for this record (never-null law).
  const elevationLabel = formatFeetValue(elevation);
  const distanceLabel = distance_m == null ? null : formatDistanceAway(distance_m);
  const meta = [elevationLabel ? `${elevationLabel} ft` : null, distanceLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card href={`/destinations/${id}`} className="h-full">
      {/* Tokens only, and 500 is the heaviest weight the text face gets
          (design-tokens.md, "Text — Geist"). The card's own hover fill is the
          affordance, so the title doesn't restate it with a color change. */}
      <div className="text-base font-medium leading-tight text-ink">
        {name || "Unnamed"}
      </div>
      {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      {primaryFeature && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="emerald">{primaryFeature}</Badge>
          {overflowFeatureCount > 0 && <Badge tone="gray">+{overflowFeatureCount}</Badge>}
        </div>
      )}
    </Card>
  );
}
