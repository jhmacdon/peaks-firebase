import type { Metadata } from "next";

// /log (the signed-in session list) and /log/import are auth-gated client
// pages with no useful content for a signed-out crawler. robots.ts now
// allows fetching under /log/ so unfurlers can read the *public*
// /log/[id] activity page's Open Graph tags (that page lives in the
// (public) route group, with its own noindex metadata, and is unaffected
// by this layout). These two pages need their own noindex since they no
// longer get one for free from a blanket robots.txt disallow.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
