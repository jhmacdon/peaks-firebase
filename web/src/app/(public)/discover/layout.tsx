import type { Metadata } from "next";
import { absoluteUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "Browse peaks, published routes, curated lists, and trip reports across the Peaks public guide.",
  alternates: {
    canonical: absoluteUrl("/discover"),
  },
  openGraph: {
    title: "Discover",
    description:
      "Browse peaks, published routes, curated lists, and trip reports across the Peaks public guide.",
    url: absoluteUrl("/discover"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Discover",
    description:
      "Browse peaks, published routes, curated lists, and trip reports across the Peaks public guide.",
  },
};

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
