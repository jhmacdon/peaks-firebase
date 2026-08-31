import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DestinationCard from "../../../../components/destination-card";
import { ContourArt } from "../../../../components/contour-art";
import { FaqSection } from "../../../../components/faq-section";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { Button } from "../../../../components/ui/button";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { getActivityLandingDataCached } from "../../../../lib/actions/cached-landing";
import type { ActivityLandingData } from "../../../../lib/actions/landing";
import {
  ACTIVITY_LANDING_TYPES,
  activityLandingConfig,
  isActivityLandingType,
  type ActivityLandingType,
} from "../../../../lib/landing-copy";
import { buildFaqJsonLd, buildListJsonLd } from "../../../../lib/json-ld";
import { hashSeed } from "../../../../lib/seed-hash";
import { absoluteUrl, siteConfig, summarizeText } from "../../../../lib/seo";
import { settled } from "../../../../lib/settled";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

const STATE_GUIDES = [
  { slug: "washington", name: "Washington" },
  { slug: "california", name: "California" },
  { slug: "colorado", name: "Colorado" },
  { slug: "oregon", name: "Oregon" },
  { slug: "utah", name: "Utah" },
  { slug: "montana", name: "Montana" },
  { slug: "alaska", name: "Alaska" },
  { slug: "new-hampshire", name: "New Hampshire" },
] as const;

// Strava's /sports/* recipe (docs/audits/2026-08-19-strava-public.md §7.10),
// built on this site's own hero and design system rather than Strava's dark
// one: the landing page's contour hero (Task 11) at a per-page seed, a
// display H1, one honest paragraph, then whatever live catalog content
// actually exists for the type — see landing-copy.ts's hasLiveContent.
//
// Only four types are real routes; anything else 404s at the routing layer
// (dynamicParams = false) rather than rendering a lookalike page for a typo.
export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  return ACTIVITY_LANDING_TYPES.map((type) => ({ type }));
}

function emptyLandingData(type: ActivityLandingType): ActivityLandingData {
  return {
    type,
    count: null,
    paragraph: activityLandingConfig(type).paragraph({ count: null }),
    top: { destinations: [], isFallback: false },
    lists: [],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  if (!isActivityLandingType(type)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const config = activityLandingConfig(type);
  const canonicalPath = `/activities/${type}`;
  const imageUrl = absoluteUrl(`${canonicalPath}/opengraph-image`);

  try {
    const data = await getActivityLandingDataCached(type);
    const description = summarizeText([data.paragraph]) ?? siteConfig.description;

    return {
      title: config.title,
      description,
      alternates: { canonical: absoluteUrl(canonicalPath) },
      ...(!config.hasLiveContent
        ? { robots: { index: false, follow: true } }
        : {}),
      openGraph: {
        title: config.h1,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
        images: [{ url: imageUrl, width: 1200, height: 630, alt: config.h1 }],
      },
      twitter: {
        card: "summary_large_image",
        title: config.h1,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    return {
      title: config.title,
      description: siteConfig.description,
      alternates: { canonical: absoluteUrl(canonicalPath) },
      robots: { index: false, follow: false },
    };
  }
}

export default async function ActivityLandingPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!isActivityLandingType(type)) notFound();

  const config = activityLandingConfig(type);
  const data = await settled(getActivityLandingDataCached(type), emptyLandingData(type));
  const seed = hashSeed(`activity:${type}`);
  const canonicalPath = `/activities/${type}`;
  const faqs = config.faqs({ count: data.count });

  const jsonLd = [
    ...(data.top.destinations.length > 0
      ? [
          buildListJsonLd({
            name: config.h1,
            url: absoluteUrl(canonicalPath),
            numberOfItems: data.top.destinations.length,
            items: data.top.destinations.map((destination) => ({
              name: destination.name,
              url: absoluteUrl(`/destinations/${destination.id}`),
            })),
          }),
        ]
      : []),
    ...(faqs.length > 0 ? [buildFaqJsonLd({ items: faqs })] : []),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}

      {/* Hero — same composition as the landing page (Task 11/18 share
          ContourArt), just a seed drawn from the type instead of the fixed
          homepage peak. No buttons here; the one primary action on this
          page lives in the CTA band below, so it isn't said twice. */}
      <section className="relative overflow-hidden">
        <div className="contour-fade pointer-events-none absolute right-2 bottom-4 w-[190px] sm:w-[240px] md:w-[300px] lg:top-1/2 lg:right-[-96px] lg:bottom-auto lg:w-[420px] lg:-translate-y-1/2 xl:right-[-64px] xl:w-[620px]">
          <ContourArt className="h-auto w-full" seed={seed} />
        </div>

        <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-40 md:pt-28 lg:pb-20">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.05] font-[680] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[52px] lg:text-[64px]">
            {config.h1}
          </h1>
          <p className="mt-6 max-w-[36ch] text-[18px] leading-[1.6] text-ink-2 sm:max-w-[52ch]">
            {data.paragraph}
          </p>
          {!config.hasLiveContent ? (
            <Link
              href="/activities/hiking"
              className="mt-6 inline-block text-sm font-medium text-accent-text hover:underline"
            >
              Browse hiking destinations →
            </Link>
          ) : null}
        </div>
      </section>

      {data.top.destinations.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow={config.label} size="lg">
            {data.top.isFallback ? "Worth a look" : "Popular destinations"}
          </SectionHeading>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.top.destinations.map((destination) => (
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

      {data.lists.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Peak-bagging" size="lg">
            The classic lists
          </SectionHeading>
          <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-3">
            {data.lists.map((list) => (
              <Link key={list.id} href={`/lists/${list.id}`} className="group block">
                <span className="block text-[17px] font-medium text-ink group-hover:underline">
                  {list.name}
                </span>
                <span className="mt-1 block text-[13px] text-muted">
                  <span className="font-mono-num tabular-nums">
                    {list.destination_count.toLocaleString("en-US")}
                  </span>{" "}
                  peaks
                  {list.completion_target < list.destination_count
                    ? ` · ${list.completion_target.toLocaleString("en-US")} required`
                    : ""}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {config.hasLiveContent ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <FaqSection items={faqs} />
        </section>
      ) : null}

      {config.hasLiveContent ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="State guides" size="lg">
            Browse mountain destinations by state
          </SectionHeading>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
            {STATE_GUIDES.map((state) => (
              <Link
                key={state.slug}
                href={`/peaks/${state.slug}`}
                prefetch={false}
                className="text-sm font-medium text-accent-text hover:underline"
              >
                {state.name} →
              </Link>
            ))}
            <Link
              href="/peaks"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              All state guides →
            </Link>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <div className="rounded-media bg-surface px-6 py-16 text-center md:px-12">
          <p className="font-display mx-auto max-w-[30ch] text-[32px] leading-[1.1] font-[620] tracking-[-0.015em] text-ink">
            Take Peaks up the mountain.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button href={APP_STORE_URL} variant="primary" external>
              Get the app
            </Button>
            <Link
              href="/discover"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Browse the catalog →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
