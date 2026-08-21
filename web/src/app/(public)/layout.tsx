"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { AuthProvider } from "../../lib/auth-context";
import AppNav from "../../components/app-nav";
import { SiteFooter } from "../../components/site-footer";

// Segments that own the whole viewport and supply their own chrome. The map
// explorer sizes itself to `100dvh` minus the nav (see --chrome-* in
// globals.css); a footer under it, or the tab-bar gutter below, would add a
// second scroll region to a page that must not scroll.
//
// `useSelectedLayoutSegment()` is the App Router's own way for a layout to
// read which child route is active, so the exception is declared once here
// rather than spread across page files — and it stays a plain list as more
// full-bleed pages arrive.
const FULL_BLEED_SEGMENTS = new Set(["map"]);

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const fullBleed = segment !== null && FULL_BLEED_SEGMENTS.has(segment);

  return (
    <AuthProvider>
      <div
        className={`flex min-h-screen flex-col ${
          fullBleed ? "" : "pb-[var(--chrome-bottom-h)] md:pb-0"
        }`}
      >
        <AppNav />
        <main className="flex-1">{children}</main>
        {fullBleed ? null : <SiteFooter />}
      </div>
    </AuthProvider>
  );
}
