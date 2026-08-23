import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getAreasIndex } from "../../../lib/actions/areas";
import {
  describeAreaIndexDesignation,
  isAreaIndexDesignation,
} from "../../../lib/area-types";
import { subdivisionName } from "../../../lib/regions";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";
import { SectionHeading } from "../../../components/ui/section-heading";
import { AreaDesignationChips } from "../../../components/area/area-designation-chips";
import { AreaStateSelect } from "../../../components/area/area-state-select";
import { AreaCard } from "../../../components/area-card";
import { FaqSection } from "../../../components/faq-section";
import { JsonLdScript } from "../../../components/json-ld-script";
import SearchBar from "../../../components/search-bar";
import { buildFaqJsonLd } from "../../../lib/json-ld";

// This page reads `searchParams` (the search box and designation chips are
// real navigations, not client-side fetches — see AreaDesignationChips),
// which makes Next render it dynamically per request regardless of this
// setting: a page that reads searchParams is excluded from static/ISR
// caching outright. `revalidate` is declared anyway because the common
// case — the plain `/areas` link the nav and footer point at, with no
// query — is the same request shape every time and cheap to re-render; it
// costs nothing to state the intent even though Next can't cache the
// filtered variants. The four detail templates this task also touches
// (route/area/list/report) get the real thing, via each segment's
// `generateStaticParams`.
export const revalidate = 3600;

const DESCRIPTION =
  "Browse national parks, forests, wilderness areas, and other protected land in the Peaks catalog.";

export const metadata: Metadata = {
  title: "Protected areas",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/areas") },
  openGraph: {
    title: "Protected areas",
    description: DESCRIPTION,
    url: absoluteUrl("/areas"),
    siteName: siteConfig.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Protected areas",
    description: DESCRIPTION,
  },
};

export default async function AreasIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; state?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const designation = isAreaIndexDesignation(params.type) ? params.type.toUpperCase() : "";
  const requestedState = (params.state ?? "").trim().toUpperCase();
  const stateName = subdivisionName("US", requestedState);
  const stateCode = stateName ? requestedState : "";
  const isFiltered = Boolean(search || designation || stateCode);

  const { areas, states, totalMatching, totalAreas } = await getAreasIndex({
    search,
    designation,
    stateCode,
    statesLimit: stateCode ? 1 : isFiltered ? 12 : 8,
    perStateLimit: stateCode ? 24 : isFiltered ? 6 : 3,
  });

  const areasByState = new Map<string, typeof areas>();
  for (const area of areas) {
    const bucket = areasByState.get(area.stateCode);
    if (bucket) {
      bucket.push(area);
    } else {
      areasByState.set(area.stateCode, [area]);
    }
  }

  const shownCount = isFiltered ? totalMatching : totalAreas;
  // Multi-state national parks appear in each state's section, but they are
  // still one park in the summary count.
  const visibleAreaCount = new Set(areas.map((area) => area.id)).size;
  const faqs = !isFiltered
    ? [
        {
          question: "How many protected areas are in Peaks?",
          answer: `Peaks has ${totalAreas.toLocaleString("en-US")} protected areas in its live catalog, including national parks, forests, wilderness areas, and other public land.`,
        },
        {
          question: "What is on a Peaks protected area page?",
          answer:
            "A protected area page can show its map, catalog facts, mountains and trailheads, routes, and recorded trips.",
        },
        {
          question: "Can I browse protected areas by state?",
          answer:
            "Yes. Use the state menu to see protected areas in one state, then open any area for its mountain guides and routes.",
        },
      ]
    : [];

  return (
    <>
      {faqs.length > 0 ? <JsonLdScript data={buildFaqJsonLd({ items: faqs })} /> : null}

      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <PageHeader
          title="Protected areas"
          meta={
            <p>
              Browse {totalAreas.toLocaleString("en-US")} national parks, forests,
              wilderness areas, and other public land in the Peaks catalog.
            </p>
          }
        />

        <Suspense fallback={<div className="mt-6 h-[104px]" />}>
          <div className="mt-6 max-w-lg">
            <SearchBar placeholder="Search protected areas" />
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <AreaDesignationChips />
            <AreaStateSelect />
          </div>
        </Suspense>

        <p className="mt-6 text-[13px] text-muted">
          Showing {visibleAreaCount.toLocaleString("en-US")} of{" "}
          <span className="font-mono-num tabular-nums">
            {shownCount.toLocaleString("en-US")}
          </span>{" "}
          {stateName
            ? `matching areas in ${stateName}`
            : isFiltered
              ? "matching areas"
              : "protected areas"}
          .
        </p>

        {stateName ? (
          <Link
            href={designation ? `/areas?type=${encodeURIComponent(designation)}` : "/areas"}
            className="mt-3 inline-block text-sm font-medium text-accent-text hover:underline"
          >
            Browse every state →
          </Link>
        ) : null}

        {states.length === 0 ? (
          <p className="mt-10 text-sm text-muted">
            No protected areas match {search ? `"${search}"` : "this filter"}.
          </p>
        ) : (
          <div className="mt-10 space-y-10">
            {states.map((state) => {
              const stateAreas = areasByState.get(state.code) ?? [];
              if (stateAreas.length === 0) return null;
              const stateLabel = subdivisionName("US", state.code) ?? state.code;

              return (
                <section key={state.code} aria-labelledby={`area-state-${state.code}`}>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <SectionHeading>
                        <span id={`area-state-${state.code}`}>{stateLabel}</span>
                      </SectionHeading>
                      <p className="mt-1 text-[13px] text-muted">
                        {state.count.toLocaleString("en-US")} {state.count === 1 ? "area" : "areas"} in the catalog
                      </p>
                    </div>
                    {!stateCode && stateAreas.length < state.count ? (
                      <Link
                        href={`/areas?state=${encodeURIComponent(state.code)}${
                          designation ? `&type=${encodeURIComponent(designation)}` : ""
                        }`}
                        className="shrink-0 text-sm font-medium text-accent-text hover:underline"
                      >
                        View {stateLabel} →
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {stateAreas.map((area) => (
                      <AreaCard
                        key={area.id}
                        area={{
                          id: area.id,
                          name: area.name,
                          kind: area.kind,
                          designation: area.designation,
                          destination_count: area.destinationCount,
                        }}
                        typeLabel={describeAreaIndexDesignation(
                          area.name,
                          area.designation,
                          area.kind
                        )}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {faqs.length > 0 ? (
          <div className="mt-20 pb-16">
            <FaqSection items={faqs} />
          </div>
        ) : null}
      </div>
    </>
  );
}
