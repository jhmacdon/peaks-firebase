import Link from "next/link";

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
  return (
    <Link
      href={`/destinations/${id}`}
      className="block p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
    >
      <div className="font-medium">{name || "Unnamed"}</div>
      <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
        {elevation != null && (
          <span>{Math.round(elevation * 3.28084).toLocaleString()} ft</span>
        )}
        {distance_m != null && (
          <>
            <span>·</span>
            <span>
              {distance_m < 1609.34
                ? `${Math.round(distance_m)} m away`
                : `${(distance_m / 1609.34).toFixed(1)} mi away`}
            </span>
          </>
        )}
      </div>
      {features.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {features.map((f) => (
            <span
              key={f}
              className="inline-block px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
