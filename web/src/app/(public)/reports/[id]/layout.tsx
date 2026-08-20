import type { Metadata } from "next";
import { getTripReport } from "../../../../lib/actions/trip-reports";
import { adminDb } from "../../../../lib/firebase-admin";
import { formatDate } from "../../../../lib/format";
import { describeTripReport } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

// One template serving every trip report, and a published report doesn't
// change after the fact except for a rare edit — same ISR contract as
// destinations/[id]/layout.tsx (Task 13). The empty `generateStaticParams`
// is what makes it real: with no paths pre-generated, Next still registers
// the route as ISR (first request renders and fills the cache) instead of
// answering every request with `Cache-Control: private, no-cache, no-store`.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

/** Live Firestore profile lookup for the byline, rather than trusting the
 * author-name snapshot stored on the report row at creation time — a
 * display name change afterward should show up here. Falls back to the
 * generic "A Peaks member" when the profile is gone or unreadable. */
async function resolveAuthorDisplayName(userId: string): Promise<string> {
  try {
    const profile = await adminDb.collection("users").doc(userId).get();
    const name = profile.exists ? profile.data()?.name : null;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // A missing or unreadable profile must not block metadata generation.
  }
  return "A Peaks member";
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

    const authorName = await resolveAuthorDisplayName(report.userId);
    const photoCount = report.blocks.filter((block) => block.type === "photo").length;

    const title = report.title;
    const description = describeTripReport({
      title,
      authorName,
      formattedDate: formatDate(report.date),
      destinationCount: report.destinations.length,
      photoCount,
    });

    const canonicalPath = `/reports/${id}`;
    // Never the report's own photos here — those are Firebase Storage
    // download URLs carrying a bucket name + access token (donner-a8608 +
    // token leak). The generic branded image is the only safe default.
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
        type: "article",
        publishedTime: report.date,
        authors: [authorName],
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
      title: "Trip report",
      description: siteConfig.description,
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}
