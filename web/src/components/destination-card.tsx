import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

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
  const elevationFeet =
    elevation != null
      ? `${Math.round(elevation * 3.28084).toLocaleString()} ft`
      : "Unknown";
  const distanceLabel =
    distance_m == null
      ? null
      : distance_m < 1609.34
        ? `${Math.round(distance_m)} m away`
        : `${(distance_m / 1609.34).toFixed(1)} mi away`;
  const meta = [elevationFeet, distanceLabel].filter(Boolean).join(" · ");

  return (
    <Card href={`/destinations/${id}`} className="h-full">
      <div className="text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {name || "Unnamed"}
      </div>
      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{meta}</div>
      {primaryFeature && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="emerald">{primaryFeature}</Badge>
          {overflowFeatureCount > 0 && <Badge tone="gray">+{overflowFeatureCount}</Badge>}
        </div>
      )}
    </Card>
  );
}
