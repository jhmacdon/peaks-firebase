import type { Metadata } from "next";
import { cache } from "react";
import {
  getDestination,
  getDestinationSessionCount,
} from "../../../../lib/actions/destinations";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { describeDestinationType } from "../../../../lib/destination-detail";
import { buildDestinationJsonLd } from "../../../../lib/json-ld";
import { subdivisionName, countryName } from "../../../../lib/regions";
import { describeDestination } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

const getDestinationForSeo = cache(getDestination);

export default async function DestinationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let jsonLd: ReturnType<typeof buildDestinationJsonLd> | null = null;

  try {
    const destination = await getDestinationForSeo(id);
    if (destination) {
      jsonLd = buildDestinationJsonLd({
        name: destination.name,
        url: absoluteUrl(`/destinations/${id}`),
        features: destination.features,
        latitude: destination.lat,
        longitude: destination.lng,
        elevationMeters: destination.elevation,
      });
    }
  } catch {
    jsonLd = null;
  }

  return (
    <>
      {jsonLd && (
        <JsonLdScript data={jsonLd} />
      )}
      {children}
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const destination = await getDestinationForSeo(id);
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
