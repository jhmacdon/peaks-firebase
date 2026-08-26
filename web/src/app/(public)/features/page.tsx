import type { Metadata } from "next";
import Link from "next/link";
import { ContourArt } from "../../../components/contour-art";
import { Button } from "../../../components/ui/button";
import { SectionHeading } from "../../../components/ui/section-heading";
import { StatCluster } from "../../../components/ui/stat";
import { CURATED_POPULAR_DESTINATIONS } from "../../../lib/constants";
import { getDestination } from "../../../lib/actions/destinations";
import { getDiscoverStats, getPopularRoutes } from "../../../lib/actions/search";
import { formatDistanceMeters, formatElevationMeters } from "../../../lib/route-guide";
import { absoluteUrl, formatFeet, siteConfig } from "../../../lib/seo";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

const DESCRIPTION =
  "What Peaks does: a searchable catalog of peaks, trailheads, and protected areas, saved routes on the map, GPS session tracking, and trip reports with photos.";

// A different peak than the landing hero's (contour-art.tsx's
// HERO_CONTOUR_SEED) — the same generator, a different seed, so the two
// pages don't draw the same summit.
const FEATURES_CONTOUR_SEED = 20260820;

const PLANNING_FEATURES = [
  {
    title: "The map",
    body: "Switch between topo and satellite, see every trailhead and route, and find what's nearby before you go.",
  },
  {
    title: "Routes",
    body: "Every standard route lists distance, gain, and shape, drawn from real GPS tracks we keep current.",
  },
  {
    title: "Saved routes",
    body: "Set a trip date, add your party, and keep the route ready for the day you climb.",
  },
];

const TRACKING_FEATURES = [
  {
    title: "Every session recorded",
    body: "The app saves your GPS track, elevation gain, and moving time the moment you finish, along with every peak you reached.",
  },
  {
    title: "The track, mapped",
    body: "See the full route drawn out and color-coded by pace, next to the numbers for that day.",
  },
  {
    title: "Lifetime stats",
    body: "See your total distance, total gain, and every summit reached, added up across every session you log.",
  },
];

const REPORT_FEATURES = [
  {
    title: "Trip reports",
    body: "Write up conditions, hazards, and what worked, right after you're back down.",
  },
  {
    title: "Photos",
    body: "Attach photos to the report so the next person sees the summit before they climb it.",
  },
];

// Rendered once an hour, same reasoning as the landing page: the reads here
// are a catalog count, a handful of destination lookups, and a popular-route
// query — cheap individually, but not worth repeating on every visit against
// a five-connection pool. Every read goes through settled(), so a database
// hiccup just narrows the page rather than taking it down.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Features",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/features") },
  openGraph: {
    title: "Features",
    description: DESCRIPTION,
    url: absoluteUrl("/features"),
    siteName: siteConfig.name,
    type: "website",
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
    title: "Features",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

/** A curated destination or a popular-route query that fails must not take
 * the page down with it — a missing one is simply left out. */
async function settled<T>(task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch {
    return null;
  }
}

const EYEBROW_CLASSES = "mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted";
const LINK_TITLE_CLASSES =
  "block text-[17px] font-medium text-ink group-hover:underline";
const LINK_META_CLASSES = "mt-1 block text-[13px] text-muted";

export default async function FeaturesPage() {
  const [stats, destinationResults, routes] = await Promise.all([
    settled(getDiscoverStats()),
    Promise.all(
      CURATED_POPULAR_DESTINATIONS.slice(0, 3).map((entry) =>
        settled(getDestination(entry.id))
      )
    ),
    settled(getPopularRoutes(3)),
  ]);

  const destinations = destinationResults.filter((row) => row !== null);

  return (
    <>
      {/* Compact hero — no actions, no two-column art. The contour emblem
          is the landing hero's small below-lg corner treatment reused at
          every width, since there's no room here for its large desktop
          column. Small and low on purpose: on a narrow viewport the subline
          wraps close to full width, so the emblem sits below it in the
          section's own bottom padding rather than beside it — the padding
          is generous at the narrowest width for exactly that clearance and
          tapers down as the paragraph stops needing the full line. */}
      <section className="relative overflow-hidden">
        <div className="contour-fade pointer-events-none absolute right-3 bottom-3 w-[100px] sm:w-[140px] md:w-[190px]">
          <ContourArt seed={FEATURES_CONTOUR_SEED} className="h-auto w-full" />
        </div>

        <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-32 sm:pb-24 md:pt-24 md:pb-16">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.05] font-[680] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[52px] lg:text-[64px]">
            Choose the route. Log the summit.
          </h1>
          <p className="mt-6 max-w-[42ch] text-[18px] leading-[1.6] text-ink-2 sm:max-w-[56ch]">
            Search the catalog, plan the route, and record the climb — then
            write up what you found.
          </p>
        </div>
      </section>

      {/* The catalog */}
      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading size="lg">The catalog</SectionHeading>
        <p className="mt-3 max-w-[60ch] text-base leading-[1.6] text-ink-2">
          Search every peak, trailhead, and protected area in the catalog —
          no account required.
        </p>

        {stats ? (
          <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4">
            <StatCluster
              scale="page"
              value={stats.destinationCount.toLocaleString("en-US")}
              label="Destinations"
            />
            <StatCluster
              scale="page"
              value={stats.areaCount.toLocaleString("en-US")}
              label="Protected areas"
            />
            <StatCluster
              scale="page"
              value={stats.routeCount.toLocaleString("en-US")}
              label="Routes"
            />
            <StatCluster
              scale="page"
              value={stats.listCount.toLocaleString("en-US")}
              label="Curated lists"
            />
          </div>
        ) : null}

        {destinations.length > 0 ? (
          <div className="mt-10">
            <p className={EYEBROW_CLASSES}>Start here</p>
            <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
              {destinations.map((destination) => {
                const elevationLabel = formatFeet(destination.elevation);
                return (
                  <Link
                    key={destination.id}
                    href={`/destinations/${destination.id}`}
                    className="group block"
                  >
                    <span className={LINK_TITLE_CLASSES}>
                      {destination.name || "Unnamed"}
                    </span>
                    {elevationLabel ? (
                      <span className={LINK_META_CLASSES}>{elevationLabel}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* Planning */}
      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading size="lg">Routes</SectionHeading>
        <p className="mt-3 max-w-[60ch] text-base leading-[1.6] text-ink-2">
          Know the route before you leave the trailhead.
        </p>

        <div className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-3">
          {PLANNING_FEATURES.map((feature) => (
            <div key={feature.title}>
              <h3 className="text-[22px] leading-snug font-medium text-ink">
                {feature.title}
              </h3>
              <p className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.6] text-ink-2">
                {feature.body}
              </p>
            </div>
          ))}
        </div>

        {routes && routes.length > 0 ? (
          <div className="mt-10">
            <p className={EYEBROW_CLASSES}>Popular routes</p>
            <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
              {routes.map((route) => (
                <Link key={route.id} href={`/routes/${route.id}`} className="group block">
                  <span className={LINK_TITLE_CLASSES}>
                    {route.name || "Unnamed route"}
                  </span>
                  <span className={LINK_META_CLASSES}>
                    {formatDistanceMeters(route.distance)} ·{" "}
                    {formatElevationMeters(route.gain)} gain
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Tracking */}
      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading size="lg">Tracking</SectionHeading>
        <p className="mt-3 max-w-[60ch] text-base leading-[1.6] text-ink-2">
          The iOS app records what you did on the mountain.
        </p>

        <div className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-3">
          {TRACKING_FEATURES.map((feature) => (
            <div key={feature.title}>
              <h3 className="text-[22px] leading-snug font-medium text-ink">
                {feature.title}
              </h3>
              <p className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.6] text-ink-2">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Reports & photos */}
      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading size="lg">Reports &amp; photos</SectionHeading>
        <p className="mt-3 max-w-[60ch] text-base leading-[1.6] text-ink-2">
          A report shows what a route is like right now, not just when we
          mapped it.
        </p>

        <div className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-2">
          {REPORT_FEATURES.map((feature) => (
            <div key={feature.title}>
              <h3 className="text-[22px] leading-snug font-medium text-ink">
                {feature.title}
              </h3>
              <p className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.6] text-ink-2">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band — the one filled primary action on this page
          (design-tokens.md, "Accent budget"). */}
      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <div className="rounded-media bg-surface px-6 py-16 text-center md:px-12">
          <p className="font-display mx-auto max-w-[30ch] text-[32px] leading-[1.1] font-[620] tracking-[-0.015em] text-ink">
            Take the whole catalog with you.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button href={APP_STORE_URL} variant="primary" external>
              Get the app
            </Button>
            <Link
              href="/discover"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Browse peaks →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
