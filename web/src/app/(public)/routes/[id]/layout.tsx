import type { Metadata } from "next";
import {
  getRoute,
  getRouteDestinations,
  getRouteSessionCount,
} from "../../../../lib/actions/routes";
import { absoluteUrl, formatFeet, formatMiles, siteConfig, summarizeText } from "../../../../lib/seo";

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

    const [destinations, sessionCount] = await Promise.all([
      getRouteDestinations(id, { publicOnly: true }),
      getRouteSessionCount(id, { publicOnly: true }),
    ]);

    const title = route.name || "Unnamed route";
    const description =
      summarizeText(
        [
          formatMiles(route.distance),
          formatFeet(route.gain),
          destinations.length > 0
            ? `${destinations.length} destination${destinations.length === 1 ? "" : "s"}`
            : null,
          route.shape ? route.shape.replace(/_/g, " ") : null,
          sessionCount > 0
            ? `${sessionCount} session${sessionCount === 1 ? "" : "s"}`
            : null,
        ],
        160
      ) ?? siteConfig.description;

    return {
      title,
      description,
      alternates: {
        canonical: absoluteUrl(`/routes/${id}`),
      },
      openGraph: {
        title,
        description,
        url: absoluteUrl(`/routes/${id}`),
        siteName: siteConfig.name,
        type: "website",
      },
      twitter: {
        card: "summary",
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
