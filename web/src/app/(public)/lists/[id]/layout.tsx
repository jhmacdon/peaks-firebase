import type { Metadata } from "next";
import { cache } from "react";
import { getList, getListDestinations } from "../../../../lib/actions/lists";
import { buildListJsonLd } from "../../../../lib/json-ld";
import { describeList } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

const getListForSeo = cache(getList);
const getListDestinationsForSeo = cache(getListDestinations);

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
      getListForSeo(id),
      getListDestinationsForSeo(id),
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
    const list = await getListForSeo(id);
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
    const description = describeList({
      name: title,
      description: list.description,
      destinationCount: list.destination_count,
    });

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
