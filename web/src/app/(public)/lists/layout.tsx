import type { Metadata } from "next";
import { absoluteUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Lists",
  description:
    "Browse curated mountain and destination lists, then track your progress across the Peaks guide.",
  alternates: {
    canonical: absoluteUrl("/lists"),
  },
  openGraph: {
    title: "Lists",
    description:
      "Browse curated mountain and destination lists, then track your progress across the Peaks guide.",
    url: absoluteUrl("/lists"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Lists",
    description:
      "Browse curated mountain and destination lists, then track your progress across the Peaks guide.",
  },
};

export default function ListsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
