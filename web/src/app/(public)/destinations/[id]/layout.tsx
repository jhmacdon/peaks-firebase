import type { Metadata } from "next";
import {
  getDestinationCached,
  getDestinationSessionCountCached,
} from "../../../../lib/actions/cached-destinations";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { describeDestinationType } from "../../../../lib/destination-detail";
import { buildDestinationJsonLd, buildFaqJsonLd } from "../../../../lib/json-ld";
import { subdivisionName, countryName } from "../../../../lib/regions";
import { describeDestination } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";
import { catalogShareImage } from "../../../../lib/catalog-share-image";
import {
  getGlacierFacts,
  getGlacierMountainById,
  getGlacierRoutes,
} from "../../../../lib/actions/cached-glaciers";
import {
  buildBreadcrumbJsonLd,
  buildGlacierJsonLd,
  describeGlacier,
  glacierFaqs,
  glacierMountainPath,
  glacierPageTitle,
  type GlacierFacts,
} from "../../../../lib/glaciers";

/** Facts for a glacier destination, or null for every other place — and
 * for a glacier whose facts can't be read, which then renders as a plain
 * destination rather than failing the page. */
async function glacierFactsFor(destination: { features: string[] } | null, id: string): Promise<GlacierFacts | null> {
  if (!destination?.features.includes("glacier")) return null;
  try {
    return await getGlacierFacts(id);
  } catch {
    return null;
  }
}

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
  let jsonLd: unknown[] | ReturnType<typeof buildDestinationJsonLd> | null = null;

  try {
    const destination = await getDestinationCached(id);
    const glacier = await glacierFactsFor(destination, id);
    if (destination && glacier) {
      const [mountain, routes] = await Promise.all([
        getGlacierMountainById(glacier.parent.id).catch(() => null),
        getGlacierRoutes(id).catch(() => []),
      ]);
      const region = subdivisionName(destination.country_code, destination.state_code);
      const url = absoluteUrl(`/destinations/${id}`);
      jsonLd = [
        buildGlacierJsonLd({
          facts: glacier,
          url,
          parentUrl: absoluteUrl(`/destinations/${glacier.parent.id}`),
          description: describeGlacier(glacier, region),
          latitude: destination.lat,
          longitude: destination.lng,
          image: destination.hero_image,
        }),
        buildBreadcrumbJsonLd([
          { name: "Glaciers", url: absoluteUrl("/glaciers") },
          ...(mountain ? [{ name: `${mountain.name} glaciers`, url: absoluteUrl(glacierMountainPath(mountain)) }] : []),
          { name: glacier.name, url },
        ]),
        buildFaqJsonLd({ items: glacierFaqs(glacier, region, routes) }),
      ];
    } else if (destination) {
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
      {Array.isArray(jsonLd)
        ? jsonLd.map((data, index) => <JsonLdScript key={index} data={data} />)
        : jsonLd && <JsonLdScript data={jsonLd} />}
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

    const glacier = await glacierFactsFor(destination, id);
    if (glacier) {
      const title = glacierPageTitle(glacier);
      const description = describeGlacier(
        glacier,
        subdivisionName(destination.country_code, destination.state_code)
      );
      const canonicalPath = `/destinations/${id}`;
      const images = [catalogShareImage(glacier.name, canonicalPath, {
        imageUrl: destination.hero_image,
        attribution: destination.hero_image_attribution,
        attributionUrl: destination.hero_image_attribution_url,
      })];
      return {
        title,
        description,
        alternates: { canonical: absoluteUrl(canonicalPath) },
        openGraph: {
          title,
          description,
          url: absoluteUrl(canonicalPath),
          siteName: siteConfig.name,
          type: "website",
          images,
        },
        twitter: { card: "summary_large_image", title, description, images },
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
    const images = [catalogShareImage(title, canonicalPath, {
      imageUrl: destination.hero_image,
      attribution: destination.hero_image_attribution,
      attributionUrl: destination.hero_image_attribution_url,
    })];

    return {
      title,
      description,
      alternates: {
        canonical: absoluteUrl(canonicalPath),
      },
      openGraph: {
        title,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
        images,
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images,
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
