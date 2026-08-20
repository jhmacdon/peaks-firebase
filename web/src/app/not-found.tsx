import type { Metadata } from "next";
import { AuthProvider } from "../lib/auth-context";
import AppNav from "../components/app-nav";
import { SiteFooter } from "../components/site-footer";
import { NotFoundContent } from "../components/not-found-content";

// The root 404 answers every unmatched URL. It renders inside the root
// layout only — no route group applies — so it assembles its own chrome,
// mirroring `(public)/layout.tsx`.
export const metadata: Metadata = {
  title: "Not found",
  description: "That page isn't on the map.",
};

export default function NotFound() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col pb-[var(--chrome-bottom-h)] md:pb-0">
        <AppNav />
        <main className="flex-1">
          <NotFoundContent />
        </main>
        <SiteFooter />
      </div>
    </AuthProvider>
  );
}
