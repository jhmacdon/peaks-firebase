import type { Metadata } from "next";
import { getPublicSessionBundle } from "../../../../lib/actions/public-sessions";
import { deriveActivityDisplayName, describeSessionActivity } from "../../../../lib/seo-descriptions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export default function LogSessionLayout({
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
    const bundle = await getPublicSessionBundle(id);
    if (!bundle) {
      return {
        title: "Activity not found",
        robots: { index: false, follow: false },
      };
    }

    const { session, destinations } = bundle;
    const title = deriveActivityDisplayName(session.name, destinations);
    const description = describeSessionActivity({
      name: title,
      distanceMeters: session.distance,
      gainMeters: session.gain,
      totalTimeSeconds: session.total_time,
    });

    const canonicalPath = `/log/${id}`;
    return {
      title,
      description,
      // Personal activity pages stay out of search results even though the
      // route itself is now crawlable (see robots.ts) so link unfurlers can
      // still read this metadata.
      robots: { index: false, follow: false },
      alternates: {
        canonical: absoluteUrl(canonicalPath),
      },
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
      title: "Activity",
      description: siteConfig.description,
      robots: { index: false, follow: false },
    };
  }
}
