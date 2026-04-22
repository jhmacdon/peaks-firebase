import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Map Explorer",
  description: "Interactive Peaks map explorer.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function MapLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
