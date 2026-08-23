import type { Metadata } from "next";
import Link from "next/link";
import { ContourArt } from "../../../components/contour-art";
import { FaqSection } from "../../../components/faq-section";
import { JsonLdScript } from "../../../components/json-ld-script";
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

      <section className="relative overflow-hidden">
        <div className="contour-fade pointer-events-none absolute right-2 bottom-4 w-[190px] sm:w-[240px] md:w-[300px] lg:top-1/2 lg:right-[-96px] lg:bottom-auto lg:w-[420px] lg:-translate-y-1/2 xl:right-[-64px] xl:w-[620px]">
          <ContourArt className="h-auto w-full" seed={48} />
        </div>

        <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-40 md:pt-28 lg:pb-20">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.05] font-[680] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[52px] lg:text-[64px]">
            Peak-bagging guides by state
          </h1>
          <p className="mt-6 max-w-[52ch] text-[18px] leading-[1.6] text-ink-2">
            Peaks is an iPhone peak-bagging app and public mountain guide. Browse{" "}
            {STATE_GUIDES.length} state guides built from live catalog data, including
            summit counts, high points, protected areas, and popular destinations. Pick
            a state to plan the next climb, then record it in Peaks.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-24 md:pb-28">
        <SectionHeading eyebrow="United States" size="lg">
          Find peaks near you
        </SectionHeading>
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {STATE_GUIDES.map((state) => (
            <Link
              key={state.code}
              href={`/peaks/${state.slug}`}
              className="text-[15px] font-medium text-accent-text hover:underline"
            >
              {state.name} →
            </Link>
          ))}
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
