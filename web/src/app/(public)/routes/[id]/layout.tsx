import type { Metadata } from "next";
import { getRoute, getRouteDestinations } from "../../../../lib/actions/routes";
import { describeRoute, pickPrimaryRouteDestinationName } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function RouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const route = await getRoute(id, { publicOnly: true });
    if (!route) {
      return {
        title: "Route not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const destinations = await getRouteDestinations(id, { publicOnly: true });

    const title = route.name || "Unnamed route";
    const primaryDestinationName = pickPrimaryRouteDestinationName(destinations);
    const description = describeRoute({
      name: title,
      distanceMeters: route.distance,
      gainMeters: route.gain,
      primaryDestinationName,
    });

    const canonicalPath = `/routes/${id}`;

    return {
      title,
      description,
      alternates: {
        canonical: absoluteUrl(canonicalPath),
      },
      // No `images` here: the co-located `opengraph-image.tsx` in this same
      // segment is picked up automatically, with the correct build-hashed,
      // cache-busted URL Next.js generates for it — a hand-built URL can't
      // reproduce that hash.
      openGraph: {
        title,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "Route",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
