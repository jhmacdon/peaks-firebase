import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { TripReport } from "../lib/actions/trip-reports";
import { formatDate } from "../lib/format";

interface TripReportCardProps {
  report: TripReport;
}

export default function TripReportCard({ report }: TripReportCardProps) {
  const date = formatDate(report.date);
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
      <div className="text-base font-medium leading-tight text-ink">{report.title}</div>
      <div className="mt-1 text-sm text-muted">
        {report.userName} · {date}
      </div>
      {preview && (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-2">{preview}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>
          {destinationCount} destination{destinationCount === 1 ? "" : "s"}
        </Badge>
        {photoCount > 0 ? (
          <Badge>
            {photoCount} photo{photoCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}
