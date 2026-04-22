import type { Metadata } from "next";
import {
  getDestination,
  getDestinationRoutes,
  getDestinationSessionCount,
} from "../../../../lib/actions/destinations";
import {
  absoluteUrl,
  formatFeet,
  locationLabel,
  siteConfig,
  summarizeText,
} from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function DestinationLayout({
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
    const destination = await getDestination(id);
    if (!destination) {
      return {
        title: "Destination not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const [routes, sessionCount] = await Promise.all([
      getDestinationRoutes(id, { publicOnly: true }),
      getDestinationSessionCount(id),
    ]);

    const title = destination.name || "Unnamed destination";
    const description =
      summarizeText(
        [
          destination.type,
          locationLabel(destination.state_code, destination.country_code),
          formatFeet(destination.elevation),
          routes.length > 0
            ? `${routes.length} route${routes.length === 1 ? "" : "s"}`
            : null,
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
        canonical: absoluteUrl(`/destinations/${id}`),
      },
      openGraph: {
        title,
        description,
        url: absoluteUrl(`/destinations/${id}`),
        siteName: siteConfig.name,
        type: "website",
        images: destination.hero_image
          ? [
              {
                url: absoluteUrl(destination.hero_image),
                width: 1200,
                height: 630,
                alt: title,
              },
            ]
          : undefined,
      },
      twitter: {
        card: destination.hero_image ? "summary_large_image" : "summary",
        title,
        description,
        images: destination.hero_image
          ? [absoluteUrl(destination.hero_image)]
          : undefined,
      },
    };
  } catch {
    return {
      title: "Destination",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
