import type { Metadata } from "next";
import Link from "next/link";
import DestinationCard from "../../components/destination-card";
import { AppScreenshots } from "../../components/app-screenshots";
import { ContourArt } from "../../components/contour-art";
import { JsonLdScript } from "../../components/json-ld-script";
import { Button } from "../../components/ui/button";
import { SectionHeading } from "../../components/ui/section-heading";
import { StatCluster } from "../../components/ui/stat";
import {
  CURATED_CLASSIC_LISTS,
  CURATED_POPULAR_DESTINATIONS,
} from "../../lib/constants";
import { formatFlooredCount } from "../../lib/format";
import { getDestination } from "../../lib/actions/destinations";
import { getList } from "../../lib/actions/lists";
import { getDiscoverStats } from "../../lib/actions/search";
import {
  buildMobileApplicationJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from "../../lib/json-ld";
import { absoluteUrl, siteConfig } from "../../lib/seo";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

const DESCRIPTION =
  "An iPhone peak-bagging tracker and public mountain guide. Log ascents, plan routes, and browse peaks, protected areas, and curated lists.";

const FEATURES = [
  {
    title: "Map-first planning",
    body: "Open the map, find the peak, and read its route and trailhead before you leave the house.",
  },
  {
    title: "Track your ascents",
    body: "The iOS app records the track, the gain, and the time, and remembers every summit you reached.",
  },
  {
    title: "Trip reports that help the next person",
    body: "Post conditions and photos after a climb, so the next party knows what to expect.",
  },
];

// The counts, the six peaks, and the three lists are all read on the server,
// so the page arrives complete — no client fetch, no "Loading…" shell.
//
// Rendered once an hour rather than once a request: this is the busiest URL
// on the site and its reads are the expensive kind (a COUNT over 70k
// destinations, six detail fetches that each carry boundary GeoJSON) against
// a five-connection pool. A catalog count an hour behind costs nothing; a
// homepage that opens a dozen connections per visitor costs plenty.
//
// The build prerenders the first copy, so the database has to be reachable
// for the page to have real numbers at deploy time — but not for the build to
// pass. Every read goes through settled(), so an unreachable database yields
// a page that simply leaves out what it couldn't load, and the next
// revalidation fills it in.
export const revalidate = 3600;

export const metadata: Metadata = {
  // Absolute: the homepage is the site, so it shouldn't render as
  // "Peaks | Peaks" through the root layout's title template.
  title: { absolute: "Peaks — peak-bagging app for iPhone" },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: {
    title: "Peaks — peak-bagging app for iPhone",
    description: DESCRIPTION,
    url: absoluteUrl("/"),
    siteName: siteConfig.name,
    type: "website",
    images: [
      {
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: "Peaks iPhone peak-bagging app",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Peaks — peak-bagging app for iPhone",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

/** A curated entry that has since been renamed, merged, or deleted must not
 * take the homepage down with it — a missing one is simply left out. */
async function settled<T>(task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const [stats, destinationResults, listResults] = await Promise.all([
    settled(getDiscoverStats()),
    Promise.all(
      CURATED_POPULAR_DESTINATIONS.map((entry) => settled(getDestination(entry.id)))
    ),
    Promise.all(CURATED_CLASSIC_LISTS.map((entry) => settled(getList(entry.id)))),
  ]);

  const destinations = destinationResults.filter((row) => row !== null);
  const lists = listResults.filter((row) => row !== null);
  const catalogSize = stats ? formatFlooredCount(stats.destinationCount) : null;

  const jsonLd = [
    buildOrganizationJsonLd({
      name: siteConfig.name,
      url: absoluteUrl("/"),
      logo: absoluteUrl("/icon.svg"),
      description: DESCRIPTION,
      sameAs: [APP_STORE_URL],
    }),
    buildWebSiteJsonLd({
      name: siteConfig.name,
      url: absoluteUrl("/"),
      description: DESCRIPTION,
      searchUrlTemplate: `${absoluteUrl("/discover")}?q={search_term_string}`,
    }),
    buildMobileApplicationJsonLd({
      name: "Peaks: Track Your Climb",
      url: absoluteUrl("/"),
      downloadUrl: APP_STORE_URL,
      operatingSystem: "iOS",
      applicationCategory: "HealthApplication",
      description: DESCRIPTION,
      price: 0,
      priceCurrency: "USD",
    }),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}

      {/* Hero. The contour art is clipped by this section, sits right of the
          copy, and carries no meaning — the page reads the same without it. */}
      <section className="relative overflow-hidden">
        {/* Two compositions, not one. From md up there's a real right-hand
            column: the field is large, vertically centered, and hangs off the
            right edge, with the copy narrow enough that the accent ring — the
            one loud part — clears it. Only outer hairline rings pass behind
            text, which is the point of them.

            Narrower than md there is no such column. The headline and subline
            run the full width, so a field beside them either crosses the copy
            or gets shoved off-screen, which is where a signature goes to die.
            It becomes a small emblem in the hero's own bottom-right corner
            instead — inset from the edge, whole, in the space the taller
            bottom padding opens under the buttons.

            The switch waits for lg, not md: at 768 the 52px headline still
            runs past 600px, which leaves no room for a field beside it. And
            the offsets are fixed pixels, not percentages — a percentage
            offset grows with the viewport, so a field tuned at a breakpoint
            walks off the right edge by the top of its own range. */}
        <div className="contour-fade pointer-events-none absolute right-2 bottom-4 w-[190px] sm:w-[240px] md:w-[300px] lg:top-1/2 lg:right-[-96px] lg:bottom-auto lg:w-[420px] lg:-translate-y-1/2 xl:right-[-64px] xl:w-[620px]">
          <ContourArt className="h-auto w-full" />
        </div>

        <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-40 md:pt-28 lg:pb-20">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.05] font-[680] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[52px] lg:text-[64px]">
            Built for serious mountain progress.
          </h1>
          <p className="mt-6 max-w-[32ch] text-[18px] leading-[1.6] text-ink-2 sm:max-w-[46ch]">
            Peaks is an iPhone peak-bagging tracker and public mountain guide. Track
            your ascents, plan the route up, and browse{" "}
            {catalogSize ? `${catalogSize} ` : ""}peaks, lakes, and trailheads.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
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

      {/* Dropped entirely if the counts don't load — a row of zeroes would
          claim an empty catalog. */}
      {stats ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4">
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
        </section>
      ) : null}

      {destinations.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Real guide pages" size="lg">
            Start with a mountain you know
          </SectionHeading>
          <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted">
            Open a photographed guide for routes, weather, maps, and the lists it belongs to.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.map((destination) => (
              <DestinationCard
                key={destination.id}
                id={destination.id}
                name={destination.name}
                elevation={destination.elevation}
                features={destination.features}
                imageUrl={destination.hero_image}
                imageFocalX={destination.hero_image_focal_x}
                imageFocalY={destination.hero_image_focal_y}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Renders nothing until screenshots land in web/public/app. */}
      <AppScreenshots className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28" />

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <h2 className="text-[22px] leading-snug font-medium text-ink">
                {feature.title}
              </h2>
              <p className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.6] text-ink-2">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {lists.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Peak-bagging" size="lg">
            The classic lists
          </SectionHeading>
          <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-3">
            {lists.map((list) => (
              <Link key={list.id} href={`/lists/${list.id}`} className="group block">
                <span className="block text-[17px] font-medium text-ink group-hover:underline">
                  {list.name}
                </span>
                <span className="mt-1 block text-[13px] text-muted">
                  <span className="font-mono-num tabular-nums">
                    {list.destination_count.toLocaleString("en-US")}
                  </span>{" "}
                  peaks
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <div className="rounded-media bg-surface px-6 py-16 text-center md:px-12">
          <p className="font-display mx-auto max-w-[30ch] text-[32px] leading-[1.1] font-[620] tracking-[-0.015em] text-ink">
            Take Peaks up the mountain.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href={APP_STORE_URL} variant="primary" external>
              Get the app
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
