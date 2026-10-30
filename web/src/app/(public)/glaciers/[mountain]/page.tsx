import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { Breadcrumb } from "../../../../components/detail-sections";
import { DetailSectionNav } from "../../../../components/detail-section-nav";
import GlacierOutlinesMap from "../../../../components/glacier/glacier-outlines-embed";
import { GlacierRosterTable } from "../../../../components/glacier/glacier-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { Topline, type ToplineStat } from "../../../../components/ui/topline";
import { getGlacierMountainBySlug, getMountainGlaciers } from "../../../../lib/actions/cached-glaciers";
import {
  buildBreadcrumbJsonLd,
  describeGlacierMountain,
  feetValue,
  formatAreaKm2,
  formatAreaMi2,
  formatPercentChange,
  glacierMountainPath,
  mountainGlacierTitle,
  rosterOutlineCredits,
} from "../../../../lib/glaciers";
import { buildListJsonLd } from "../../../../lib/json-ld";
import { formatRegion, subdivisionName } from "../../../../lib/regions";
import { absoluteUrl, siteConfig } from "../../../../lib/seo";
import { catalogShareImage } from "../../../../lib/catalog-share-image";

type Params = { params: Promise<{ mountain: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mountain: slug } = await params;
  try {
    const mountain = await getGlacierMountainBySlug(slug);
    if (!mountain) return { title: "Glaciers not found", robots: { index: false, follow: false } };
    const title = mountainGlacierTitle(mountain);
    const description = describeGlacierMountain(mountain, subdivisionName(mountain.country_code, mountain.state_code));
    const path = glacierMountainPath(mountain);
    const images = [catalogShareImage(`${mountain.name} glaciers`, path, {
      imageUrl: mountain.hero_image,
      attribution: mountain.hero_image_attribution,
      attributionUrl: mountain.hero_image_attribution_url,
    })];
    return {
      title,
      description,
      alternates: { canonical: absoluteUrl(path) },
      openGraph: { title, description, url: absoluteUrl(path), siteName: siteConfig.name, type: "website", images },
      twitter: { card: "summary_large_image", title, description, images },
    };
  } catch {
    return { title: "Glaciers", robots: { index: false, follow: false } };
  }
}

export default async function GlacierMountainPage({ params }: Params) {
  const { mountain: slug } = await params;
  const mountain = await getGlacierMountainBySlug(slug);
  if (!mountain) notFound();

  const glaciers = await getMountainGlaciers(mountain.id, true);
  if (glaciers.length === 0) throw new Error(`No glaciers for ${mountain.id}`);

  const path = glacierMountainPath(mountain);
  const region = formatRegion(mountain.state_code, mountain.country_code);
  const context = mountain.context;
  const credits = rosterOutlineCredits(glaciers);
  const outlines = glaciers.flatMap((g) => (g.boundary ? [{ id: g.id, name: g.name, boundary: g.boundary }] : []));
  const ranked = glaciers.filter((g) => g.kind === "glacier" && g.area_km2 != null);
  const largest = ranked[0];
  const highestHead = [...glaciers].filter((g) => g.head_elevation_m != null).sort((a, b) => b.head_elevation_m! - a.head_elevation_m!)[0];
  const lowestTerminus = [...glaciers]
    .filter((g) => g.terminus_elevation_m != null)
    .sort((a, b) => a.terminus_elevation_m! - b.terminus_elevation_m!)[0];

  const stats: ToplineStat[] = [
    context?.named_glacier_count
      ? { key: "named", value: String(context.named_glacier_count), label: "Named glaciers" }
      : { key: "mapped", value: String(mountain.glacier_count), label: "Glaciers mapped" },
    context?.area_km2 != null
      ? {
          key: "area",
          value: formatAreaMi2(context.area_km2).replace(" mi²", ""),
          unit: "mi²",
          label: context.observed_year ? `Ice area, ${context.observed_year}` : "Ice area",
        }
      : null,
    context?.percent_change_since_history_start != null && context.history_start_year != null
      ? { key: "change", value: formatPercentChange(context.percent_change_since_history_start), label: `Since ${context.history_start_year}` }
      : null,
    mountain.elevation != null ? { key: "summit", value: feetValue(mountain.elevation), unit: "ft", label: "Summit" } : null,
  ].filter((s): s is ToplineStat => s !== null);

  const intro = [
    `${mountain.name}${region ? `, in ${region},` : ""} carries ${
      context?.named_glacier_count ? `${context.named_glacier_count} named glaciers` : `${mountain.glacier_count} mapped glaciers`
    }${context?.area_km2 != null ? ` covering ${formatAreaMi2(context.area_km2)} (${formatAreaKm2(context.area_km2)})${context.observed_year ? ` in ${context.observed_year}` : ""}` : ""}.`,
    largest?.area_km2 != null ? `${largest.name} is the largest, at ${formatAreaMi2(largest.area_km2)}.` : null,
    highestHead && lowestTerminus
      ? `Ice reaches from ${feetValue(highestHead.head_elevation_m!)} ft at the head of ${highestHead.name} down to ${feetValue(
          lowestTerminus.terminus_elevation_m!
        )} ft at the terminus of ${lowestTerminus.name}.`
      : null,
    context?.percent_change_since_history_start != null && context.history_start_year != null
      ? `Across the mountain, glacier area has ${context.percent_change_since_history_start < 0 ? "fallen" : "grown"} ${Math.round(
          Math.abs(context.percent_change_since_history_start)
        )}% since ${context.history_start_year}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const jsonLd = [
    buildListJsonLd({
      name: `${mountain.name} glaciers`,
      url: absoluteUrl(path),
      numberOfItems: glaciers.length,
      items: glaciers.map((g) => ({ name: g.name, url: absoluteUrl(`/destinations/${g.id}`) })),
    }),
    buildBreadcrumbJsonLd([
      { name: "Glaciers", url: absoluteUrl("/glaciers") },
      { name: `${mountain.name} glaciers`, url: absoluteUrl(path) },
    ]),
  ];

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLdScript key={index} data={data} />
      ))}
      <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-6">
        <PageHeader
          breadcrumb={<Breadcrumb current={mountain.name} parentHref="/glaciers" parentLabel="Glaciers" />}
          title={`${mountain.name} glaciers`}
          meta={
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              <Link href={`/destinations/${mountain.id}`} className="text-accent-text hover:underline">
                {mountain.name}
              </Link>
              {region ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{region}</span>
                </>
              ) : null}
            </p>
          }
        />
        <p className="mt-4 max-w-[68ch] text-base leading-[1.7] text-ink-2">{intro}</p>
        <Topline stats={stats} className="mt-8" />

        <DetailSectionNav
          sections={[
            ...(outlines.length ? [{ id: "glacier-map", label: "Map" }] : []),
            { id: "glacier-roster", label: "All glaciers" },
            { id: "glacier-sources", label: "Sources" },
          ]}
        />

        <div className="space-y-14">
          {outlines.length ? (
            <section id="glacier-map" className="scroll-mt-24" aria-labelledby="glacier-map-heading">
              <SectionHeading eyebrow="Select an outline to open its page">
                <span id="glacier-map-heading">Map</span>
              </SectionHeading>
              <div className="rounded-media mt-4 isolate overflow-hidden">
                <GlacierOutlinesMap
                  outlines={outlines}
                  credits={credits.map((c) => c.credit)}
                  className="h-[380px] sm:h-[520px]"
                />
              </div>
            </section>
          ) : null}

          <section id="glacier-roster" className="scroll-mt-24" aria-labelledby="glacier-roster-heading">
            <SectionHeading eyebrow="Largest first">
              <span id="glacier-roster-heading">All {glaciers.length} on {mountain.name}</span>
            </SectionHeading>
            <GlacierRosterTable glaciers={glaciers} caption={`Glaciers on ${mountain.name}, by area`} className="mt-4" />
          </section>

          <section id="glacier-sources" className="scroll-mt-24" aria-labelledby="glacier-sources-heading">
            <SectionHeading>
              <span id="glacier-sources-heading">Sources</span>
            </SectionHeading>
            <ul className="mt-4 max-w-[68ch] space-y-2 text-sm leading-6 text-ink-2">
              {mountain.facts_credit ? (
                <li>
                  <span className="text-muted">Measurements: </span>
                  {mountain.facts_source_url ? (
                    <a href={mountain.facts_source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
                      {mountain.facts_credit}
                    </a>
                  ) : (
                    mountain.facts_credit
                  )}
                </li>
              ) : null}
              {credits.map((credit) => (
                <li key={`${credit.credit}-${credit.license}`}>
                  <span className="text-muted">Outlines ({credit.count}): </span>
                  {credit.credit}
                  {credit.license ? (
                    <>
                      {" · "}
                      {credit.licenseUrl ? (
                        <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
                          {credit.license}
                        </a>
                      ) : (
                        credit.license
                      )}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-muted">Each glacier’s page names its own outline source, date, and survey tables.</p>
          </section>
        </div>
      </div>
    </>
  );
}
