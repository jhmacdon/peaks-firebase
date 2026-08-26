import type { Metadata } from "next";
// The same wrapped reference `page.tsx` uses — importing the raw action
// here instead would read the report row a second time per request.
import { getTripReportCached } from "../../../../lib/actions/cached-reports";
import { adminDb } from "../../../../lib/firebase-admin";
import { formatDate } from "../../../../lib/format";
import { describeTripReport } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";
import { formatReportAuthorName } from "../../../../components/report-author-name";

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
    const name = formatReportAuthorName(profile.exists ? profile.data()?.name : null);
    if (name) return name;
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
    const report = await getTripReportCached(id);
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
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
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
