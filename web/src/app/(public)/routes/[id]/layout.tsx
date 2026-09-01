import type { Metadata } from "next";
import { JsonLdScript } from "../../../../components/json-ld-script";
import {
  getRouteCached,
  getRouteDestinationsCached,
} from "../../../../lib/actions/cached-routes";
import { buildRouteJsonLd } from "../../../../lib/json-ld";
import { describeRoute, pickPrimaryRouteDestinationName } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

// One template serving every published route, and a route's geometry and
// stats change on the order of months, not requests — same reasoning as
// destinations/[id]/layout.tsx (Task 13), copied here rather than shared
// since Next.js resolves `revalidate`/`generateStaticParams` per segment
// file, not per import.
//
// The empty `generateStaticParams` is what makes ISR real rather than
// inert: with no params generated, Next still registers the route as ISR
// (first request renders and fills the cache, `x-nextjs-cache: MISS` then
// `HIT`) instead of answering every request with
// `Cache-Control: private, no-cache, no-store`. Build time is unchanged —
// no route page is generated ahead of a request.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export default async function RouteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let jsonLd: ReturnType<typeof buildRouteJsonLd> | null = null;

  try {
    const route = await getRouteCached(id);
    if (route) {
      jsonLd = buildRouteJsonLd({
        name: route.name,
        url: absoluteUrl(`/routes/${id}`),
        image: route.cover_image,
        distanceMeters: route.distance,
        gainMeters: route.gain,
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
    const route = await getRouteCached(id);
    if (!route) {
      return {
        title: "Route not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const destinations = await getRouteDestinationsCached(id);

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
      // The co-located image route uses this route's derived destination cover
      // when one exists, with the plain branded panel as its fallback.
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
