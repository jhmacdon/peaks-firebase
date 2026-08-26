import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { getPublicRouteBundle } from "../../../../components/public-route-data";
import { absoluteUrl, formatFeet, formatMiles, siteConfig, summarizeText } from "../../../../lib/seo";
import { publicSavedRoutePath } from "../../../../components/route-paths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function describeSharedRoute(input: {
  name: string;
  description: string;
  distance: number | null;
  gain: number | null;
}): string {
  const facts = [formatMiles(input.distance), input.gain != null ? `${formatFeet(input.gain)} gain` : null]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return (
    summarizeText([
      `${input.name}:`,
      input.description || (facts ? `${facts}.` : "a shared route on Peaks."),
    ]) ?? `${input.name} on Peaks.`
  );
}

export default function PublicRouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  noStore();
  const { id } = await params;
  const bundle = await getPublicRouteBundle(id);
  if (!bundle) {
    return {
      title: "Route not found",
      robots: { index: false, follow: false },
    };
  }

  const title = bundle.plan.name || "Shared route";
  const description = describeSharedRoute({
    name: title,
    description: bundle.plan.description,
    distance: bundle.plan.distance,
    gain: bundle.plan.gain,
  });
  const canonicalPath = publicSavedRoutePath(id);

  return {
    title,
    description,
    // Saved routes are shared by link, not listed as public profile content.
    // Link preview bots can still read Open Graph metadata with noindex set.
    robots: { index: false, follow: false },
    alternates: { canonical: absoluteUrl(canonicalPath) },
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
}
