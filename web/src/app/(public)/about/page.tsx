import type { Metadata } from "next";
import { getDiscoverStats } from "../../../lib/actions/search";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";
import { AppScreenshots } from "../../../components/app-screenshots";
import { settled } from "../../../lib/settled";
import { Button } from "../../../components/ui/button";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";
const SUPPORT_EMAIL = "support@getpeaks.app";
const DESCRIPTION =
  "What Peaks is, how the catalog is built, and how to reach us.";

// getDiscoverStats() has no cookie/header read to signal "this needs a
// fresh request" to Next, so without this it statically freezes the
// catalog counts at build time — "live catalog stat row" (task brief) means
// per-request, same as sitemap.ts's own use of force-dynamic for its
// DB-backed routes.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "About",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/about") },
  openGraph: {
    title: "About",
    description: DESCRIPTION,
    url: absoluteUrl("/about"),
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
    title: "About",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default async function AboutPage() {
  const stats = await settled(getDiscoverStats(), null);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <PageHeader title="About Peaks" />

      <div className="mt-8 max-w-[68ch] space-y-5 text-[15px] leading-7 text-ink-2">
        <p>
          Peaks is a peak-bagging tracker and guidebook. The iOS app
          records GPS tracks, elevation, and photos as you climb. This
          site is the same catalog on the web — destinations, routes,
          protected areas, and curated lists, all browsable without an
          account.
        </p>
        <p>
          The catalog draws on public sources, plus routes and corrections
          from people who climb them. You’ll find source credits on place
          and route pages.
        </p>
      </div>

      {stats && <p className="mt-6 text-sm text-muted">Explore {stats.destinationCount.toLocaleString("en-US")} places, {stats.routeCount.toLocaleString("en-US")} routes, and {stats.listCount.toLocaleString("en-US")} peak lists.</p>}
      <section className="mt-10 grid items-center gap-10 lg:grid-cols-2">
        <div><h2 className="text-2xl font-semibold">A record of your time outside</h2><p className="mt-4 max-w-[48ch] text-lg leading-relaxed text-ink-2">Use Peaks to choose where to go and remember the places you’ve been. Your activity, photos, and plans belong together.</p><Button className="mt-6" href="/discover" variant="secondary">Explore the catalog</Button></div>
        <AppScreenshots />
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button href={APP_STORE_URL} variant="primary">
          Get the iOS app
        </Button>
        {/* Plain anchor, not <Button external>: mailto: isn't a page to
            open in a new tab, it hands off to the mail client — a
            target="_blank" would leave a stray blank tab behind. */}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-sm font-medium text-accent-text hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  );
}
