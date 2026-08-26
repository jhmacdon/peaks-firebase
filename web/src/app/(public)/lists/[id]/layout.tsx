import type { Metadata } from "next";
import {
  getCachedList,
  getCachedListDestinations,
} from "../../../../lib/actions/cached-lists";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { buildListJsonLd } from "../../../../lib/json-ld";
import { describeList } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig, summarizeText } from "../../../../lib/seo";

// One template serving every curated list, and a list's membership changes
// on the order of months, not requests — same ISR contract as
// destinations/[id]/layout.tsx (Task 13). The empty `generateStaticParams`
// is what makes it real: with no paths pre-generated, Next still registers
// the route as ISR (first request renders and fills the cache) instead of
// answering every request with `Cache-Control: private, no-cache, no-store`.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export default async function ListLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let jsonLd: ReturnType<typeof buildListJsonLd> | null = null;

  try {
    const [list, destinations] = await Promise.all([
      getCachedList(id),
      getCachedListDestinations(id),
    ]);
    if (list) {
      jsonLd = buildListJsonLd({
        name: list.name,
        url: absoluteUrl(`/lists/${id}`),
        numberOfItems: list.destination_count,
        items: destinations.map((destination) => ({
          name: destination.name,
          url: absoluteUrl(`/destinations/${destination.id}`),
        })),
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
    const list = await getCachedList(id);
    if (!list) {
      return {
        title: "List not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const title = list.name;
    const description =
      summarizeText([
        describeList({
          name: title,
          description: list.description,
          destinationCount: list.destination_count,
        }),
      ]) ?? `${title} on Peaks.`;

    const canonicalPath = `/lists/${id}`;
    const imageUrl = absoluteUrl("/opengraph-image");

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
        images: [{ url: imageUrl, width: 1200, height: 630, alt: siteConfig.name }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    return {
      title: "List",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
