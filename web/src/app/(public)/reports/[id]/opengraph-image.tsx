import { ImageResponse } from "next/og";
import { getTripReportCached } from "../../../../lib/actions/cached-reports";
import { formatDate } from "../../../../lib/format";
import { EntityOgImage } from "../../../../lib/seo-image";
import { joinStats } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name = "Trip report";
  let stats: string | null = null;

  try {
    const report = await getTripReportCached(id);
    if (report) {
      name = report.title || name;
      const photoCount = report.blocks.filter((block) => block.type === "photo").length;
      stats = joinStats([
        formatDate(report.date),
        report.destinations.length > 0
          ? `${report.destinations.length} ${report.destinations.length === 1 ? "destination" : "destinations"}`
          : null,
        photoCount > 0 ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"}` : null,
      ]);
    }
  } catch {
    // Keep the safe branded fallback; report photo URLs are never read here.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
