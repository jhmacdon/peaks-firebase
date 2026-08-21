import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getAreasIndex } from "../../../lib/actions/areas";
import { describeDesignation, isAreaIndexDesignation } from "../../../lib/area-types";
import { subdivisionName } from "../../../lib/regions";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";
import { SectionHeading } from "../../../components/ui/section-heading";
import { AreaDesignationChips } from "../../../components/area/area-designation-chips";
import SearchBar from "../../../components/search-bar";

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
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const designation = isAreaIndexDesignation(params.type) ? params.type.toUpperCase() : "";
  const isFiltered = Boolean(search || designation);

  const { areas, states, totalMatching, totalAreas } = await getAreasIndex({
    search,
    designation,
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

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        title="Protected areas"
        meta={
          <p>
            National parks, forests, wilderness areas, and other public land in the
            catalog.
          </p>
        }
      />

      <Suspense fallback={<div className="mt-6 h-[84px]" />}>
        <div className="mt-6 max-w-lg">
          <SearchBar placeholder="Search protected areas" />
        </div>
        <AreaDesignationChips />
      </Suspense>

      <p className="mt-6 text-[13px] text-muted">
        Showing {visibleAreaCount.toLocaleString("en-US")} of{" "}
        <span className="font-mono-num tabular-nums">
          {shownCount.toLocaleString("en-US")}
        </span>{" "}
        {isFiltered ? "matching areas" : "protected areas"}.
      </p>

      {states.length === 0 ? (
        <p className="mt-10 text-sm text-muted">
          No protected areas match {search ? `"${search}"` : "this filter"}.
        </p>
      ) : (
        <div className="mt-10 space-y-12">
          {states.map((state) => {
            const stateAreas = areasByState.get(state.code) ?? [];
            if (stateAreas.length === 0) return null;
            const stateLabel = subdivisionName("US", state.code) ?? state.code;

            return (
              <section key={state.code} aria-labelledby={`area-state-${state.code}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <SectionHeading>
                    <span id={`area-state-${state.code}`}>{stateLabel}</span>
                  </SectionHeading>
                  <span className="text-[13px] text-muted">
                    {stateAreas.length < state.count
                      ? `Showing ${stateAreas.length.toLocaleString("en-US")} of ${state.count.toLocaleString("en-US")}`
                      : `${state.count.toLocaleString("en-US")} ${state.count === 1 ? "area" : "areas"}`}
                  </span>
                </div>
                <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {stateAreas.map((area) => (
                    <li key={area.id}>
                      <Link
                        href={`/areas/${encodeURIComponent(area.id)}`}
                        className="group flex items-center justify-between gap-4 py-3"
                      >
                        <span className="min-w-0 truncate text-[15px] font-medium text-ink group-hover:underline">
                          {area.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-4 text-[13px] text-muted">
                          <span>{describeDesignation(area.designation, area.kind)}</span>
                          <span className="font-mono-num tabular-nums">
                            {area.destinationCount.toLocaleString("en-US")}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
