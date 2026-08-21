import Link from "next/link";
import { notFound } from "next/navigation";
import { getArea } from "../../../../lib/actions/areas";
import { describeDesignation, describeManager } from "../../../../lib/area-types";
import { formatRegionList } from "../../../../lib/regions";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { DestinationMetaRow } from "../../../../components/destination/destination-meta-row";
import {
  Topline,
  type ToplineStat,
} from "../../../../components/ui/topline";
import { AreaHero } from "../../../../components/area/area-hero";
import { AreaAbout } from "../../../../components/area/area-about";
import { AreaFacts } from "../../../../components/area/area-facts";
import { AreaActivity } from "../../../../components/area/area-activity";
import { AreaDestinations } from "../../../../components/area/area-destinations";
import { AreaRoutes } from "../../../../components/area/area-routes";

function sourceLabel(source: string, version: string): string {
  const name = source.toLowerCase() === "padus" ? "USGS PAD-US" : source;
  return version ? `${name} ${version}` : name;
}

export default async function AreaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const area = await getArea(id);
  if (!area) notFound();

  const managerLabel = describeManager(area.manager);
  const regionLabel = formatRegionList(area.state_codes, area.country_code);
  const designationLabel = describeDesignation(area.designation, area.kind);
  const catalogSource = sourceLabel(area.source, area.source_version);

  const toplineStats: ToplineStat[] = [
    area.destination_count > 0
      ? {
          key: "destinations",
          value: area.destination_count.toLocaleString("en-US"),
          label: area.destination_count === 1 ? "Destination" : "Destinations",
        }
      : null,
    area.route_count > 0
      ? {
          key: "routes",
          value: area.route_count.toLocaleString("en-US"),
          label: area.route_count === 1 ? "Route" : "Routes",
        }
      : null,
  ].filter((stat): stat is ToplineStat => stat !== null);

  // Designation already leads the hero's scrim, and region already sits in
  // the meta row under the H1 — the facts grid below doesn't repeat either
  // (design-tokens.md's "every stat once" reading of law 3). Manager is the
  // one fact with nowhere else to live.
  const facts = managerLabel ? [{ label: "Manager", value: managerLabel }] : [];

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={
          <Breadcrumb current={area.name} parentHref="/areas" parentLabel="Protected areas" />
        }
        title={area.name}
        meta={<DestinationMetaRow alert={null} parts={[regionLabel]} />}
      />

      {area.parent_id && area.parent_name ? (
        <Link
          href={`/areas/${encodeURIComponent(area.parent_id)}`}
          className="mt-3 inline-flex text-sm font-medium text-accent-text hover:underline"
        >
          Within {area.parent_name}
        </Link>
      ) : null}

      <AreaHero area={area} designationLabel={designationLabel} className="mt-8" />

      <Topline stats={toplineStats} className="mt-10" />

      <div className="mt-12 space-y-12">
        <AreaActivity areaId={area.id} />

        <AreaAbout
          name={area.name}
          description={area.description}
          sourceName={area.description_source_name}
          sourceUrl={area.description_source_url}
          sourceLicense={area.description_source_license}
          fallbackCredit={catalogSource}
        />

        <AreaFacts facts={facts} />

        <AreaDestinations
          destinations={area.destinations}
          totalCount={area.destination_count}
        />

        <AreaRoutes routes={area.routes} totalCount={area.route_count} />
      </div>
    </div>
  );
}
