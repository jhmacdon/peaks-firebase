import type { Metadata } from "next";
import { getAreaSummary } from "../../../../lib/actions/areas";
import { describeDesignation } from "../../../../lib/area-types";
import { formatRegionList } from "../../../../lib/regions";
import { describeArea } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function AreaLayout({
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
    const area = await getAreaSummary(id);
    if (!area) {
      return {
        title: "Protected area not found",
        robots: { index: false, follow: false },
      };
    }

    const description = describeArea({
      name: area.name,
      designationLabel: describeDesignation(area.designation, area.kind),
      region: formatRegionList(area.state_codes, area.country_code),
      destinationCount: area.destination_count,
      routeCount: area.route_count,
    });

    const canonicalPath = `/areas/${encodeURIComponent(id)}`;

    return {
      title: area.name,
      description,
      alternates: {
        canonical: absoluteUrl(canonicalPath),
      },
      // No `images` here: the co-located `opengraph-image.tsx` in this same
      // segment is picked up automatically, with the correct build-hashed,
      // cache-busted URL Next.js generates for it — a hand-built URL can't
      // reproduce that hash.
      openGraph: {
        title: area.name,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: area.name,
        description,
      },
    };
  } catch {
    return {
      title: "Protected area",
      description: siteConfig.description,
      robots: { index: false, follow: false },
    };
  }
}
