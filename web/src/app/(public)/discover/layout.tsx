import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "../../../lib/seo";

const DESCRIPTION =
  "Browse peaks, published routes, curated lists, and trip reports across the Peaks public guide.";

export const metadata: Metadata = {
  title: "Discover",
  description: DESCRIPTION,
  alternates: {
    canonical: absoluteUrl("/discover"),
  },
  // A segment that defines its own `openGraph` object replaces the root
  // one entirely rather than merging into it, so the image + site name
  // need repeating here — omitting them is exactly how this page lost its
  // og:image before.
  openGraph: {
    title: "Discover",
    description: DESCRIPTION,
    url: absoluteUrl("/discover"),
    siteName: siteConfig.name,
    images: [
      {
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Discover",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
