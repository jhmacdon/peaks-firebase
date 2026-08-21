import TripReportCard from "../trip-report-card";
import { DISCOVER_GRID, DiscoverSection } from "./discover-section";
import { DiscoverReportAction } from "./discover-report-action";
import type { TripReport } from "../../lib/actions/trip-reports";

/**
 * Recent field notes. The query only returns reports from the last 18
 * months, and the section is absent when that comes back empty — a report
 * from four years ago is not "recent" just because it is the newest one on
 * file.
 */
export function DiscoverReports({ reports }: { reports: TripReport[] }) {
  if (reports.length === 0) return null;

  return (
    <DiscoverSection
      id="recent-reports"
      title="Recent trip reports"
      description="Conditions and field notes from recent outings."
      action={<DiscoverReportAction />}
    >
      <div className={DISCOVER_GRID}>
        {reports.map((report) => (
          <TripReportCard key={report.id} report={report} />
        ))}
      </div>
    </DiscoverSection>
  );
}
