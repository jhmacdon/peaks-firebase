import Link from "next/link";

interface PlanCardProps {
  id: string;
  name: string;
  date: string | null;
  destinationCount: number;
  partySize: number;
}

export default function PlanCard({
  id,
  name,
  date,
  destinationCount,
  partySize,
}: PlanCardProps) {
  return (
    <Link
      href={`/plans/${id}`}
      className="block p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
    >
      <div className="font-medium">{name || "Untitled Plan"}</div>
      {date && (
        <div className="text-sm text-gray-500 mt-1">
          {new Date(date).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )}
      <div className="flex gap-4 mt-3 text-sm text-gray-600 dark:text-gray-400">
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
    </Link>
  );
}
