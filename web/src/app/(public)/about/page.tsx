import type { Metadata } from "next";
import { getDiscoverStats } from "../../../lib/actions/search";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";
import { StatCluster } from "../../../components/ui/stat";
import { Button } from "../../../components/ui/button";
import { SiteFooter } from "../../../components/site-footer";

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
export const dynamic = "force-dynamic";

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
  const stats = await getDiscoverStats();

  return (
    <>
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
            The catalog draws on public sources — OpenStreetMap, USGS, and
            Peakbagger — plus routes and corrections from people who climb
            them. It grows every week.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-10 gap-y-6">
          <StatCluster
            scale="page"
            value={stats.destinationCount.toLocaleString("en-US")}
            label="Destination guides"
          />
          <StatCluster
            scale="page"
            value={stats.areaCount.toLocaleString("en-US")}
            label="Protected areas"
          />
          <StatCluster
            scale="page"
            value={stats.routeCount.toLocaleString("en-US")}
            label="Published routes"
          />
          <StatCluster
            scale="page"
            value={stats.listCount.toLocaleString("en-US")}
            label="Curated lists"
          />
        </div>

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
      <SiteFooter />
    </>
  );
}
