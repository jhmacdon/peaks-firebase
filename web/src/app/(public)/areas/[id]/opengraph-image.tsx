import { ImageResponse } from "next/og";
import { getAreaSummary } from "../../../../lib/actions/areas";
import { describeDesignation } from "../../../../lib/area-types";
import { formatRegionList } from "../../../../lib/regions";
import { EntityOgImage } from "../../../../lib/seo-image";
import { joinStats } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let name = "Protected area";
  let stats: string | null = null;

  try {
    const area = await getAreaSummary(id);
    if (area) {
      name = area.name;
      stats = joinStats([
        describeDesignation(area.designation, area.kind),
        formatRegionList(area.state_codes, area.country_code),
        area.destination_count > 0
          ? `${area.destination_count} ${area.destination_count === 1 ? "destination" : "destinations"}`
          : null,
      ]);
    }
  } catch {
    // Render the generic panel below rather than fail the image request.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
