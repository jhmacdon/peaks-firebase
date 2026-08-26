import { ImageResponse } from "next/og";
import { getRoute, getRouteDestinations } from "../../../../lib/actions/routes";
import { pickPrimaryRouteDestinationName } from "../../../../lib/seo-descriptions";
import { EntityOgImage } from "../../../../lib/seo-image";
import { formatFeet, formatMiles, joinStats } from "../../../../lib/seo";

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

  let name = "Route";
  let stats: string | null = null;

  try {
    const route = await getRoute(id);
    if (route) {
      name = route.name || "Unnamed route";
      const destinations = await getRouteDestinations(id);
      const primaryDestinationName = pickPrimaryRouteDestinationName(destinations);
      stats = joinStats([
        formatMiles(route.distance),
        route.gain != null ? `${formatFeet(route.gain)} gain` : null,
        primaryDestinationName,
      ]);
    }
  } catch {
    // Render the generic panel below rather than fail the image request.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
