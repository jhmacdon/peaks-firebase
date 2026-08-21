import { ImageResponse } from "next/og";
import { getDestination } from "../../../../lib/actions/destinations";
import { describeDestinationType } from "../../../../lib/destination-detail";
import { subdivisionName, countryName } from "../../../../lib/regions";
import { EntityOgImage } from "../../../../lib/seo-image";
import { formatFeet, joinStats } from "../../../../lib/seo";

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

  let name = "Destination";
  let stats: string | null = null;

  try {
    const destination = await getDestination(id);
    if (destination) {
      name = destination.name || "Unnamed destination";
      const featureWord = describeDestinationType(destination.type, destination.features);
      const region =
        subdivisionName(destination.country_code, destination.state_code) ??
        countryName(destination.country_code);
      stats = joinStats([formatFeet(destination.elevation), featureWord, region]);
    }
  } catch {
    // Render the generic panel below rather than fail the image request.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
