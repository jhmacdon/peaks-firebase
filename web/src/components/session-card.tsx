import Link from "next/link";

interface SessionCardProps {
  id: string;
  name: string | null;
  destinationNames?: string[];
  start_time: string;
  distance: number | null;
  gain: number | null;
  total_time: number | null;
}

/** Derive a display name: explicit name > destinations reached > fallback */
function deriveSessionName(name: string | null, destinationNames?: string[]): string {
  if (name) return name;
  if (destinationNames && destinationNames.length > 0) {
    return destinationNames.join(", ");
  }
  return "Untitled Session";
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SessionCard({
  id,
  name,
  destinationNames,
  start_time,
  distance,
  gain,
  total_time,
}: SessionCardProps) {
  const date = new Date(start_time);
  const displayName = deriveSessionName(name, destinationNames);

  return (
    <Link
      href={`/log/${id}`}
      className="block p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
    >
      <div>
        <div className="font-medium">{displayName}</div>
        <div className="text-sm text-gray-500 mt-0.5">
          {date.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      <div className="flex gap-4 mt-3 text-sm text-gray-600 dark:text-gray-400">
        {distance != null && (
          <span>{(distance / 1609.34).toFixed(1)} mi</span>
        )}
        {gain != null && (
          <span>{Math.round(gain * 3.28084).toLocaleString()} ft</span>
        )}
        {total_time != null && <span>{formatDuration(total_time)}</span>}
      </div>
    </Link>
  );
}
