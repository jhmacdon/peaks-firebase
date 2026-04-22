import type { Metadata } from "next";
import { getList } from "../../../../lib/actions/lists";
import { absoluteUrl, siteConfig, summarizeText } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function ListLayout({
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
    const list = await getList(id);
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
      summarizeText(
        [
          list.description,
          `${list.destination_count} destination${list.destination_count === 1 ? "" : "s"}`,
        ],
        160
      ) ?? siteConfig.description;

    return {
      title,
      description,
      alternates: {
        canonical: absoluteUrl(`/lists/${id}`),
      },
      openGraph: {
        title,
        description,
        url: absoluteUrl(`/lists/${id}`),
        siteName: siteConfig.name,
        type: "website",
      },
      twitter: {
        card: "summary",
        title,
        description,
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
