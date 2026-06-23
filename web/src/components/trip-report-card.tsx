import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { TripReport } from "../lib/actions/trip-reports";

interface TripReportCardProps {
  report: TripReport;
}

export default function TripReportCard({ report }: TripReportCardProps) {
  const date = new Date(report.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const photoCount = report.blocks.filter((block) => block.type === "photo").length;
  const destinationCount = report.destinations.length;
  const firstTextBlock = report.blocks.find((b) => b.type === "text");
  const preview = firstTextBlock?.content
    ? firstTextBlock.content.length > 200
      ? firstTextBlock.content.slice(0, 200) + "..."
      : firstTextBlock.content
    : null;

  return (
    <Card href={`/reports/${report.id}`} className="h-full">
      <Badge tone="gray">Field report</Badge>
      <div className="mt-2 text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {report.title}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {report.userName} · {date}
      </div>
      {preview && (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
          {preview}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="gray">
          {destinationCount} destination{destinationCount === 1 ? "" : "s"}
        </Badge>
        <Badge tone="gray">
          {photoCount} photo{photoCount === 1 ? "" : "s"}
        </Badge>
      </div>
    </Card>
  );
}
