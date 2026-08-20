import { Card } from "./ui/card";

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
    <Card href={`/plans/${id}`}>
      <div className="font-medium text-ink">{name || "Untitled Plan"}</div>
      {date && (
        <div className="text-sm text-muted mt-1">
          {new Date(date).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )}
      <div className="flex gap-4 mt-3 text-sm text-ink-2">
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
    </Card>
  );
}
