import type { Metadata } from "next";
import {
  getDestination,
  getDestinationSessionCount,
} from "../../../../lib/actions/destinations";
import { describeDestinationType } from "../../../../lib/destination-detail";
import { subdivisionName, countryName } from "../../../../lib/regions";
import { describeDestination } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

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

    const sessionCount = await getDestinationSessionCount(id);

    const title = destination.name || "Unnamed destination";
    const featureWord =
      describeDestinationType(destination.type, destination.features)?.toLowerCase() ?? null;
    const region =
      subdivisionName(destination.country_code, destination.state_code) ??
      countryName(destination.country_code);

    const description = describeDestination({
      name: title,
      elevationMeters: destination.elevation,
      featureWord,
      region,
      sessionCount,
    });

    const canonicalPath = `/destinations/${id}`;

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
      title: "Destination",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
