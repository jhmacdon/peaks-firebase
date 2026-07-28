import type { Metadata } from "next";
import { getAreaSummary } from "../../../../lib/actions/areas";
import {
  absoluteUrl,
  siteConfig,
  summarizeText,
} from "../../../../lib/seo";

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

    const description =
      summarizeText(
        [
          area.description,
          `${area.destination_count} ${
            area.destination_count === 1 ? "destination" : "destinations"
          }.`,
          `${area.route_count} ${area.route_count === 1 ? "route" : "routes"}.`,
        ],
        160
      ) ?? siteConfig.description;
    const canonicalPath = `/areas/${encodeURIComponent(id)}`;

    return {
      title: area.name,
      description,
      alternates: {
        canonical: absoluteUrl(canonicalPath),
      },
      openGraph: {
        title: area.name,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
      },
      twitter: {
        card: "summary",
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
