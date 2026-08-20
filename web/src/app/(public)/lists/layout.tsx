import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "../../../lib/seo";

const DESCRIPTION =
  "Browse curated mountain and destination lists, then track your progress across the Peaks guide.";

export const metadata: Metadata = {
  // A bare string here would replace the root's title template for every
  // page beneath this segment (the same shallow-replace behavior that
  // dropped og:image) — /lists/[id] would render with no " | Peaks"
  // suffix. Re-declaring the template keeps it in effect for children.
  title: {
    default: "Lists",
    template: `%s | ${siteConfig.name}`,
  },
  description: DESCRIPTION,
  alternates: {
    canonical: absoluteUrl("/lists"),
  },
  // A segment that defines its own `openGraph` object replaces the root
  // one entirely rather than merging into it, so the image + site name
  // need repeating here — omitting them is exactly how this page lost its
  // og:image before.
  openGraph: {
    title: "Lists",
    description: DESCRIPTION,
    url: absoluteUrl("/lists"),
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
    title: "Lists",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default function ListsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
