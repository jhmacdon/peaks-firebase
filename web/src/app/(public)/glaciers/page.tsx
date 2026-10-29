import type { Metadata } from "next";
import Link from "next/link";
import { JsonLdScript } from "../../../components/json-ld-script";
import { Breadcrumb } from "../../../components/detail-sections";
import { GlacierFaqList } from "../../../components/glacier/glacier-sections";
import { PageHeader } from "../../../components/ui/page-header";
import { SectionHeading } from "../../../components/ui/section-heading";
import { Topline } from "../../../components/ui/topline";
import { getGlacierMountains, getMountainGlaciers } from "../../../lib/actions/cached-glaciers";
import {
  buildBreadcrumbJsonLd,
  feetValue,
  formatAreaKm2,
  formatAreaMi2,
  formatPercentChange,
  glacierMountainPath,
  type GlacierFaq,
} from "../../../lib/glaciers";
import { buildFaqJsonLd, buildListJsonLd } from "../../../lib/json-ld";
import { formatRegion } from "../../../lib/regions";
import { absoluteUrl, siteConfig } from "../../../lib/seo";

// The roster reads the database; like the fire-lookout guides it renders on
// request (the reads themselves are cached for an hour in cached-glaciers.ts)
// so a build never needs Cloud SQL.
export const dynamic = "force-dynamic";

const TITLE = "Glaciers: maps, sizes & retreat";
const DESCRIPTION =
  "Every glacier in the Peaks catalog, by mountain: mapped outlines, area, top and terminus elevations, length, and how much ice each has lost since the first survey.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/glaciers") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl("/glaciers"),
    siteName: siteConfig.name,
    type: "website",
    images: [{ url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: "Glaciers in Peaks" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [absoluteUrl("/twitter-image")] },
};

export default async function GlaciersIndexPage() {
  const mountains = await getGlacierMountains();
  // An empty catalog is a failed read, never an indexable empty guide.
  if (mountains.length === 0) throw new Error("Glacier catalog is empty");
  const rosters = await Promise.all(mountains.map((mountain) => getMountainGlaciers(mountain.id, false)));
  const glacierTotal = mountains.reduce((sum, m) => sum + m.glacier_count, 0);
  const mappedArea = mountains.reduce((sum, m) => sum + (m.mapped_area_km2 ?? 0), 0);

  const faqs: GlacierFaq[] = [
    {
      question: "Which mountains have glacier pages on Peaks?",
      answer: `Peaks maps ${glacierTotal} named glaciers on ${mountains.length} ${mountains.length === 1 ? "mountain" : "mountains"}: ${mountains
        .map((m) => m.name)
        .join(", ")}. More mountains are added as their glacier inventories are reviewed.`,
    },
    {
      question: "Where do the glacier measurements come from?",
      answer:
        "Area, elevations, length, slope, and survey history come from published glacier inventories, credited on every glacier page. Outlines come from OpenStreetMap or GLIMS glacier inventories; each page names its outline source and date.",
    },
    {
      question: "Can I track glacier crossings?",
      answer:
        "Yes. The Peaks iPhone app records your climbs and marks each glacier you crossed, with distance on ice and the elevation band, on the activity timeline.",
    },
  ];

  const jsonLd = [
    buildListJsonLd({
      name: "Glaciers by mountain",
      url: absoluteUrl("/glaciers"),
      numberOfItems: mountains.length,
      items: mountains.map((m) => ({ name: `${m.name} glaciers`, url: absoluteUrl(glacierMountainPath(m)) })),
    }),
    buildBreadcrumbJsonLd([
      { name: "Discover", url: absoluteUrl("/discover") },
      { name: "Glaciers", url: absoluteUrl("/glaciers") },
    ]),
    buildFaqJsonLd({ items: faqs }),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}
      <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-6">
        <PageHeader breadcrumb={<Breadcrumb current="Glaciers" />} title="Glaciers" />
        <p className="mt-4 max-w-[68ch] text-base leading-[1.7] text-ink-2">
          Mapped glaciers and permanent snowfields on the mountains Peaks covers. Each page has the glacier’s outline on a topo
          map, its measured size and elevations, how its area has changed across the published surveys, and the routes that cross it.
        </p>
        <Topline
          className="mt-8"
          stats={[
            { key: "glaciers", value: glacierTotal.toLocaleString("en-US"), label: "Glaciers mapped" },
            { key: "mountains", value: mountains.length.toLocaleString("en-US"), label: mountains.length === 1 ? "Mountain" : "Mountains" },
            ...(mappedArea > 0
              ? [{ key: "area", value: formatAreaMi2(mappedArea).replace(" mi²", ""), unit: "mi²", label: "Measured ice area" }]
              : []),
          ]}
        />

        <div className="mt-14 space-y-14">
          {mountains.map((mountain, index) => {
            const roster = rosters[index];
            const context = mountain.context;
            const region = formatRegion(mountain.state_code, mountain.country_code);
            return (
              <section key={mountain.id} aria-labelledby={`mountain-${mountain.slug}`}>
                <SectionHeading eyebrow={region ?? undefined}>
                  <Link id={`mountain-${mountain.slug}`} href={glacierMountainPath(mountain)} className="hover:underline">
                    {mountain.name} glaciers
                  </Link>
                </SectionHeading>
                <p className="mt-2 max-w-[68ch] text-sm leading-6 text-ink-2">
                  {[
                    `${mountain.glacier_count} mapped ${mountain.glacier_count === 1 ? "glacier" : "glaciers"}${
                      mountain.snowfield_count ? ` and ${mountain.snowfield_count} ${mountain.snowfield_count === 1 ? "snowfield" : "snowfields"}` : ""
                    }`,
                    mountain.elevation != null ? `summit ${feetValue(mountain.elevation)} ft` : null,
                    context?.area_km2 != null
                      ? `${formatAreaMi2(context.area_km2)} (${formatAreaKm2(context.area_km2)}) of ice${context.observed_year ? ` in ${context.observed_year}` : ""}`
                      : null,
                    context?.percent_change_since_history_start != null && context.history_start_year != null
                      ? `${formatPercentChange(context.percent_change_since_history_start)} since ${context.history_start_year}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ul className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                  {roster.map((glacier) => (
                    <li key={glacier.id} className="border-b border-hairline">
                      <Link href={`/destinations/${glacier.id}`} className="group flex min-h-12 items-center justify-between gap-4 py-2.5">
                        <span className="truncate text-[15px] font-medium text-ink group-hover:underline">{glacier.name}</span>
                        <span className="shrink-0 text-[13px] tabular-nums text-muted">
                          {glacier.area_km2 != null ? formatAreaMi2(glacier.area_km2) : glacier.kind === "snowfield" ? "Snowfield" : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href={glacierMountainPath(mountain)} className="mt-4 inline-block text-sm font-medium text-accent-text hover:underline">
                  Map and full table for {mountain.name} →
                </Link>
              </section>
            );
          })}
        </div>

        <GlacierFaqList items={faqs} className="mt-16" />
      </div>
    </>
  );
}
