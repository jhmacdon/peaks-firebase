import type { Metadata } from "next";
import Link from "next/link";
import { FaqSection } from "../../../components/faq-section";
import { JsonLdScript } from "../../../components/json-ld-script";
import { LandingPhotoHero } from "../../../components/landing-photo-hero";
import { Button } from "../../../components/ui/button";
import { SectionHeading } from "../../../components/ui/section-heading";
import { buildFaqJsonLd, buildListJsonLd } from "../../../lib/json-ld";
import { INDEXABLE_US_STATE_CODES } from "../../../lib/landing-copy";
import { subdivisionName, usStateSlugFromCode } from "../../../lib/regions";
import { absoluteUrl, siteConfig } from "../../../lib/seo";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

const DESCRIPTION =
  "Browse peak-bagging guides for 48 US states, with live summit counts, high points, protected areas, routes, and mountain destinations from Peaks.";

const STATE_GUIDES = INDEXABLE_US_STATE_CODES.flatMap((code) => {
  const name = subdivisionName("US", code);
  const slug = usStateSlugFromCode(code);
  return name && slug ? [{ code, name, slug }] : [];
});

const FAQS = [
  {
    question: "How many state peak-bagging guides does Peaks have?",
    answer: `Peaks publishes ${STATE_GUIDES.length} US state guides with enough live catalog data to support a useful page. Each guide includes current destination and summit counts plus its highest cataloged peak.`,
  },
  {
    question: "Can I track state high points in Peaks?",
    answer:
      "Yes. The Peaks iPhone app records reached summits, and curated lists show your progress across challenges such as the US state high points.",
  },
  {
    question: "Can I browse Peaks without the iPhone app?",
    answer:
      "Yes. The public Peaks web guide works in a browser. The iPhone app adds ascent recording, personal history, list progress, photos, and trip reports.",
  },
];

export const metadata: Metadata = {
  title: "Peak-bagging guides by state",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/peaks") },
  openGraph: {
    title: "Peak-bagging guides by state",
    description: DESCRIPTION,
    url: absoluteUrl("/peaks"),
    siteName: siteConfig.name,
    type: "website",
    images: [
      {
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: "Peak-bagging guides by state in Peaks",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Peak-bagging guides by state",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default function StateGuideIndexPage() {
  const jsonLd = [
    buildListJsonLd({
      name: "Peak-bagging guides by state",
      url: absoluteUrl("/peaks"),
      numberOfItems: STATE_GUIDES.length,
      items: STATE_GUIDES.map((state) => ({
        name: `Peak-bagging in ${state.name}`,
        url: absoluteUrl(`/peaks/${state.slug}`),
      })),
    }),
    buildFaqJsonLd({ items: FAQS }),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}

      <LandingPhotoHero
        eyebrow={`${STATE_GUIDES.length} live state guides`}
        title="Peak-bagging guides by state"
        description={
          <>
            Peaks is an iPhone peak-bagging app and public mountain guide. Browse{" "}
            {STATE_GUIDES.length} state guides built from live catalog data, including
            summit counts, high points, protected areas, and popular destinations. Pick
            a state to plan the next climb, then record it in Peaks.
          </>
        }
        actions={
          <>
            <Button href="#state-guides" variant="primary">
              Choose a state
            </Button>
            <Button href={APP_STORE_URL} variant="secondary" external>
              Get the app
            </Button>
          </>
        }
        afterActions={
          <div className="grid max-w-[520px] grid-cols-3 gap-5 border-t border-hairline pt-5">
            <div>
              <p className="font-mono-num text-[18px] text-ink">48</p>
              <p className="mt-1 text-[11px] leading-4 text-muted">State guides</p>
            </div>
            <div>
              <p className="text-[13px] font-medium text-ink">Live catalog</p>
              <p className="mt-1 text-[11px] leading-4 text-muted">Counts and high points</p>
            </div>
            <div>
              <p className="text-[13px] font-medium text-ink">iPhone sync</p>
              <p className="mt-1 text-[11px] leading-4 text-muted">Ascents and list progress</p>
            </div>
          </div>
        }
      />

      <section id="state-guides" className="mx-auto max-w-[1200px] scroll-mt-20 px-6 py-24 md:py-28">
        <SectionHeading eyebrow="United States" size="lg">
          Find peaks near you
        </SectionHeading>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted">
          Each guide opens with the highest peak in the Peaks catalog, then shows live
          totals, popular places, protected areas, and nearby state guides.
        </p>
        <div className="mt-7 rounded-media border border-hairline bg-surface px-5 py-2 sm:px-7 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-8">
            {STATE_GUIDES.map((state) => (
              <Link
                key={state.code}
                href={`/peaks/${state.slug}`}
                prefetch={false}
                className="group flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3 text-[15px] font-medium text-ink last:border-b-0 hover:text-accent-text sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+4)]:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="font-mono-num w-6 shrink-0 text-[11px] text-muted">
                    {state.code}
                  </span>
                  <span className="truncate">{state.name}</span>
                </span>
                <span aria-hidden="true" className="text-muted group-hover:text-accent-text">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <FaqSection items={FAQS} />
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
              href="/activities/peak-bagging"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Read the peak-bagging guide →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
