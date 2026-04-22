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
      className="group block rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-lg font-semibold tracking-tight text-gray-950 transition-colors group-hover:text-blue-700 dark:text-gray-50 dark:group-hover:text-blue-300">
          {name || "Unnamed"}
        </div>
        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
          View
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
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
        <div className="mt-4 flex flex-wrap gap-2">
          {features.map((f) => (
            <span
              key={f}
              className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
