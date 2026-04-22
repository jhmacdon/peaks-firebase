import type { Metadata } from "next";
import { getTripReport } from "../../../../lib/actions/trip-reports";
import { absoluteUrl, siteConfig, summarizeText } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function ReportLayout({
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
    const report = await getTripReport(id);
    if (!report) {
      return {
        title: "Trip report not found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const firstTextBlock = report.blocks.find((block) => block.type === "text");
    const firstPhotoBlock = report.blocks.find((block) => block.type === "photo");
    const title = report.title;
    const description =
      summarizeText(
        [
          firstTextBlock?.content,
          report.userName ? `By ${report.userName}` : null,
          report.date ? new Date(report.date).toLocaleDateString("en-US") : null,
        ],
        160
      ) ?? siteConfig.description;

    return {
      title,
      description,
      alternates: {
        canonical: absoluteUrl(`/reports/${id}`),
      },
      openGraph: {
        title,
        description,
        url: absoluteUrl(`/reports/${id}`),
        siteName: siteConfig.name,
        type: "article",
        publishedTime: report.date,
        authors: [report.userName],
        images: firstPhotoBlock
          ? [
              {
                url: absoluteUrl(firstPhotoBlock.content),
                width: 1200,
                height: 630,
                alt: title,
              },
            ]
          : undefined,
      },
      twitter: {
        card: firstPhotoBlock ? "summary_large_image" : "summary",
        title,
        description,
        images: firstPhotoBlock
          ? [absoluteUrl(firstPhotoBlock.content)]
          : undefined,
      },
    };
  } catch {
    return {
      title: "Trip report",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
