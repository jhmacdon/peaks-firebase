import { ImageResponse } from "next/og";
import { getRoute, getRouteDestinations } from "../../../../lib/actions/routes";
import { pickPrimaryRouteDestinationName } from "../../../../lib/seo-descriptions";
import {
  EntityOgImage,
  isPublicDomainImageAttribution,
} from "../../../../lib/seo-image";
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
  let imageUrl: string | null = null;
  let imageFocalX = 50;
  let imageFocalY = 50;
  let imageAttribution: string | null = null;

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
      // A PNG cannot preserve working source and license links. CC BY and
      // CC BY-SA covers remain on the linked route page; only an explicit
      // public-domain grant may be cropped into the standalone share image.
      if (isPublicDomainImageAttribution(route.cover_image_attribution)) {
        imageUrl = route.cover_image;
        imageFocalX = route.cover_image_focal_x ?? 50;
        imageFocalY = route.cover_image_focal_y ?? 50;
        imageAttribution = route.cover_image_attribution;
      }
    }
  } catch {
    // Render the generic panel below rather than fail the image request.
  }

  return new ImageResponse(
    <EntityOgImage
      name={name}
      stats={stats}
      imageUrl={imageUrl}
      imageFocalX={imageFocalX}
      imageFocalY={imageFocalY}
      imageAttribution={imageAttribution}
    />,
    size
  );
}
