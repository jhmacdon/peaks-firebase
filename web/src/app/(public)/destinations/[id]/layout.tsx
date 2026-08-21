import type { Metadata } from "next";
import {
  getDestinationCached,
  getDestinationSessionCountCached,
} from "../../../../lib/actions/cached-destinations";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { describeDestinationType } from "../../../../lib/destination-detail";
import { buildDestinationJsonLd } from "../../../../lib/json-ld";
import { subdivisionName, countryName } from "../../../../lib/regions";
import { describeDestination } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

// One template, ~70,000 catalog pages, and the record behind any one of
// them changes on the order of months. Rendering every visit against a
// five-connection pool buys nothing, so the segment is cached for an hour —
// declared here rather than on the page so metadata, JSON-LD, and the body
// share one window and can't drift apart. Nothing on this route reads
// cookies or headers; the sign-in-dependent parts (Save, personal activity)
// are client islands that fetch after hydration, so one cached response is
// correct for every reader.
//
// The empty `generateStaticParams` is what makes the hour real, and it
// prebuilds NOTHING. `revalidate` on its own is inert for a dynamic segment
// with no params generated: Next leaves the route out of the prerender
// manifest entirely and answers every request with
// `Cache-Control: private, no-cache, no-store` (measured — the render
// timestamp changed on every curl). Returning `[]` puts the route in the
// static-generation pass with zero paths, which registers it as an ISR
// route: first request renders and fills the cache, the rest are served
// from it (`x-nextjs-cache: MISS` then `HIT`, `s-maxage=3600`). Build time
// is unchanged — no page is generated ahead of a request.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

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
    const destination = await getDestinationCached(id);
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
    const destination = await getDestinationCached(id);
    if (!destination) {
      return {
        title: "Destination not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const sessionCount = await getDestinationSessionCountCached(id);

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
