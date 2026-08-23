import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AreaCard from "../../../../components/area-card";
import DestinationCard from "../../../../components/destination-card";
import { ContourArt } from "../../../../components/contour-art";
import { FaqSection } from "../../../../components/faq-section";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { Button } from "../../../../components/ui/button";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { getStateLandingDataCached } from "../../../../lib/actions/cached-landing";
import { buildFaqJsonLd, buildListJsonLd } from "../../../../lib/json-ld";
import { buildStateLandingFaqs } from "../../../../lib/landing-copy";
import { hashSeed } from "../../../../lib/seed-hash";
import {
  usStateCodeFromSlug,
  subdivisionName,
} from "../../../../lib/regions";
import { absoluteUrl, siteConfig, summarizeText } from "../../../../lib/seo";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

// Same recipe as /activities/[type] (see that page's header comment): the
// landing page's contour hero at a per-page seed, a display H1, one
// editorial paragraph computed from catalog facts, then live content.
//
// Unlike /activities, the state space isn't a fixed four. No state page is
// rendered during a deploy: a database outage must not block the build or
// bake a false 404 into the output. The first request
// renders a valid state and fills the ISR cache. A bad slug or a real state
// with no catalog presence still 404s in the page body.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state } = await params;
  const stateCode = usStateCodeFromSlug(state);
  if (!stateCode) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const canonicalPath = `/peaks/${state}`;
  const imageUrl = absoluteUrl(`${canonicalPath}/opengraph-image`);

  try {
    const data = await getStateLandingDataCached(stateCode);
    if (!data) {
      return { title: "Not found", robots: { index: false, follow: false } };
    }

    const title = `The peaks of ${data.stateName}`;
    const description = summarizeText([data.paragraph]) ?? siteConfig.description;

    return {
      title,
      description,
      alternates: { canonical: absoluteUrl(canonicalPath) },
      openGraph: {
        title,
        description,
        url: absoluteUrl(canonicalPath),
        siteName: siteConfig.name,
        type: "website",
        images: [{ url: imageUrl, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    const stateName = subdivisionName("US", stateCode) ?? state;
    return {
      title: `The peaks of ${stateName}`,
      description: siteConfig.description,
      alternates: { canonical: absoluteUrl(canonicalPath) },
      robots: { index: false, follow: false },
    };
  }
}

export default async function StateLandingPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const stateCode = usStateCodeFromSlug(state);
  if (!stateCode) notFound();

  // Do not translate a database fault into notFound(). A 5xx asks crawlers
  // to retry; a false 404 tells them the state guide was removed.
  const data = await getStateLandingDataCached(stateCode);
  if (!data) notFound();

  const seed = hashSeed(`state:${stateCode}`);
  const canonicalPath = `/peaks/${state}`;
  const h1 = `The peaks of ${data.stateName}`;
  const faqs = buildStateLandingFaqs({
    stateName: data.stateName,
    destinationCount: data.destinationCount,
    summitCount: data.summitCount,
    highestPeak: data.highestPeak,
    leadingArea: data.leadingArea,
  });

  const jsonLd = [
    ...(data.top.destinations.length > 0
      ? [
          buildListJsonLd({
            name: h1,
            url: absoluteUrl(canonicalPath),
            numberOfItems: data.top.destinations.length,
            items: data.top.destinations.map((destination) => ({
              name: destination.name,
              url: absoluteUrl(`/destinations/${destination.id}`),
            })),
          }),
        ]
      : []),
    buildFaqJsonLd({ items: faqs }),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}

      {/* Hero — same composition as /activities/[type] and the landing page;
          seed is drawn from the state code so every state draws a distinct
          peak. No buttons here; see the CTA band below. */}
      <section className="relative overflow-hidden">
        <div className="contour-fade pointer-events-none absolute right-2 bottom-4 w-[190px] sm:w-[240px] md:w-[300px] lg:top-1/2 lg:right-[-96px] lg:bottom-auto lg:w-[420px] lg:-translate-y-1/2 xl:right-[-64px] xl:w-[620px]">
          <ContourArt className="h-auto w-full" seed={seed} />
        </div>

        <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-40 md:pt-28 lg:pb-20">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.05] font-[680] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[52px] lg:text-[64px]">
            {h1}
          </h1>
          <p className="mt-6 max-w-[36ch] text-[18px] leading-[1.6] text-ink-2 sm:max-w-[52ch]">
            {data.paragraph}
          </p>
        </div>
      </section>

      {data.top.destinations.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow={data.stateName} size="lg">
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

      {data.areas.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Protected areas" size="lg">
            Where these peaks sit
          </SectionHeading>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.areas.map((area) => (
              <AreaCard
                key={area.id}
                area={{
                  id: area.id,
                  name: area.name,
                  kind: area.kind,
                  designation: area.designation,
                  destination_count: area.destinationCount,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <FaqSection items={faqs} />
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading eyebrow="Keep browsing" size="lg">
          Plan a trip in {data.stateName}
        </SectionHeading>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
          <Link
            href="/activities/hiking"
            className="text-sm font-medium text-accent-text hover:underline"
          >
            Hiking guides →
          </Link>
          <Link
            href="/activities/peak-bagging"
            className="text-sm font-medium text-accent-text hover:underline"
          >
            Peak-bagging lists →
          </Link>
          <Link
            href={`/areas?state=${encodeURIComponent(stateCode)}`}
            className="text-sm font-medium text-accent-text hover:underline"
          >
            Protected areas →
          </Link>
          <Link
            href={`/discover?q=${encodeURIComponent(data.stateName)}`}
            className="text-sm font-medium text-accent-text hover:underline"
          >
            Search {data.stateName} →
          </Link>
        </div>
      </section>

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
