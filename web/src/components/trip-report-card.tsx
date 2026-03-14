import Link from "next/link";
import type { TripReport } from "@/lib/actions/trip-reports";

interface TripReportCardProps {
  report: TripReport;
}

export default function TripReportCard({ report }: TripReportCardProps) {
  const date = new Date(report.date);

  // Find first text block for preview
  const firstTextBlock = report.blocks.find((b) => b.type === "text");
  const preview = firstTextBlock?.content
    ? firstTextBlock.content.length > 200
      ? firstTextBlock.content.slice(0, 200) + "..."
      : firstTextBlock.content
    : null;

  return (
    <Link
      href={`/reports/${report.id}`}
      className="block p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
    >
      <div className="font-medium">{report.title}</div>
      <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
        <span>{report.userName}</span>
        <span>&middot;</span>
        <span>
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
      {preview && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
          {preview}
        </p>
      )}
    </Link>
  );
}
