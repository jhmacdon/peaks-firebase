import type { Metadata } from "next";
import Link from "next/link";
import DestinationCard from "../../components/destination-card";
import { AppScreenshots } from "../../components/app-screenshots";
import { JsonLdScript } from "../../components/json-ld-script";
import { ExploreHero } from "../../components/explore-hero";
import ListCard from "../../components/list-card";
import { subdivisionName } from "../../lib/regions";
import { Button } from "../../components/ui/button";
import { SectionHeading } from "../../components/ui/section-heading";
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
  "An iPhone peak-bagging tracker and public mountain guide. Log ascents, save routes, and browse peaks, protected areas, and curated lists.";

const FEATURES = [
  {
    title: "Map-first routes",
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

      <ExploreHero />
      <section className="mx-auto max-w-[1200px] px-6 py-10 md:py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading size="lg">Explore by region</SectionHeading>
          <Link href="/peaks" className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline">All states →</Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[["WA", "Washington"], ["CO", "Colorado"], ["CA", "California"], ["NH", "New Hampshire"], ["NY", "New York"], ["OR", "Oregon"]].map(([code, label]) => (
            <Button key={code} href={`/discover?state=${code}`} variant="secondary">{label}</Button>
          ))}
        </div>
      </section>

      {destinations.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-12 md:pb-16">
          <SectionHeading size="lg">
            Explore popular peaks
          </SectionHeading>
          <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted">
            Find a route, check the forecast, and see recent activity before you go.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.map((destination) => (
              <DestinationCard
                key={destination.id}
                id={destination.id}
                name={destination.name}
                elevation={destination.elevation}
                features={destination.features}
                locationLabel={subdivisionName(destination.country_code ?? "US", destination.state_code ?? "")}
                imageUrl={destination.hero_image} imageAttribution={destination.hero_image_attribution} imageAttributionUrl={destination.hero_image_attribution_url}
                imageFocalX={destination.hero_image_focal_x}
                imageFocalY={destination.hero_image_focal_y}
              />
            ))}
          </div>
        </section>
      ) : null}



      <section className="mx-auto max-w-[1200px] px-6 pb-12 md:pb-16">
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
        <section className="mx-auto max-w-[1200px] px-6 pb-12 md:pb-16">
          <SectionHeading eyebrow="Peak-bagging" size="lg">
            The classic lists
          </SectionHeading>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {lists.map((list) => <ListCard key={list.id} list={list} compact />)}
          </div>
        </section>
      ) : null}

      <section className="bg-surface py-12 md:py-16">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading size="lg">Keep every climb with you</SectionHeading>
            <p className="mt-4 max-w-[42ch] text-lg leading-relaxed text-ink-2">Record your route with Peaks for iPhone, explore the map, and see your year in the mountains.</p>
            <div className="mt-6 flex flex-wrap gap-3"><Button href={APP_STORE_URL} external>Get the iPhone app</Button><Button href="/features" variant="secondary">See the features</Button></div>
            {catalogSize && <p className="mt-6 text-sm text-muted">{catalogSize} places to explore, with routes, protected areas, and peak lists.</p>}
          </div>
          <AppScreenshots />
        </div>
      </section>
    </>
  );
}
