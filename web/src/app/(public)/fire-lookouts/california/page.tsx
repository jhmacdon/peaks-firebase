import type { Metadata } from "next";
import { FireLookoutGuide } from "../../../../components/fire-lookout-guide";
import { GUIDES } from "../../../../lib/guides";
import { absoluteUrl } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

const guide = GUIDES.find((entry) => entry.slug === "california-fire-lookouts")!;
export const metadata: Metadata = {
  title: guide.title,
  description: guide.description,
  alternates: { canonical: absoluteUrl(guide.href) },
  openGraph: { title: guide.title, description: guide.description, url: absoluteUrl(guide.href), type: "article" },
  twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
};

export default function LookoutsPage() {
  return <FireLookoutGuide state="california" />;
}
