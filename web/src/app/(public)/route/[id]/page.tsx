import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import {
  buildPlanMapMarkers,
  buildPlanMapRoutes,
  buildPlanTopline,
} from "../../../../lib/plan-detail";
import { formatFeet, formatMiles } from "../../../../lib/destination-detail";
import { getPublicRouteBundle } from "../../../../components/public-route-data";
import { PublicRouteMap } from "../../../../components/public-route-map";
import { ShareLinkButton } from "../../../../components/share-link-button";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { Topline } from "../../../../components/ui/topline";
import {
  catalogRoutePath,
  publicSavedRoutePath,
} from "../../../../components/route-paths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSavedRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  noStore();
  const { id } = await params;
  const bundle = await getPublicRouteBundle(id);
  if (!bundle) notFound();

  const { plan } = bundle;
  const name = plan.name || "Untitled Route";
  const mapRoutes = buildPlanMapRoutes(bundle.routes);
  const mapMarkers = buildPlanMapMarkers(bundle.destinations, bundle.reachedDestinations);
  const hasMapContent = mapRoutes.length > 0 || mapMarkers.length > 0 || Boolean(plan.path);
  const toplineStats = buildPlanTopline(plan);
  const tripDate = plan.date
    ? plan.date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb current={name} />}
        title={name}
        meta={
          <p>
            {[tripDate ? `Trip Date: ${tripDate}` : null, "Public route"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        }
        actions={
          <ShareLinkButton
            url={publicSavedRoutePath(id)}
            title={name}
          />
        }
      />

      {toplineStats.length > 0 ? <Topline stats={toplineStats} className="mt-8" /> : null}

      {plan.description ? (
        <p className="mt-6 max-w-[68ch] text-ink-2">{plan.description}</p>
      ) : null}

      {hasMapContent ? (
        <section className="mt-8" aria-labelledby="shared-route-map-heading">
          <SectionHeading>
            <span id="shared-route-map-heading">Map</span>
          </SectionHeading>
          <div className="isolate mt-4 overflow-hidden rounded-media">
            <PublicRouteMap
              routes={mapRoutes}
              destinations={mapMarkers}
              path={plan.path}
              className="h-[320px] sm:h-[420px]"
            />
          </div>
        </section>
      ) : null}

      {bundle.reachedDestinations.length > 0 ? (
        <section className="mt-8 rounded-media border border-border bg-surface p-6">
          <SectionHeading>Reached along the way</SectionHeading>
          <ol className="mt-4 divide-y divide-hairline">
            {bundle.reachedDestinations.map((destination) => (
              <li key={destination.id} className="flex items-center justify-between gap-4 py-3">
                <Link href={`/destinations/${destination.id}`} className="font-medium text-ink hover:underline">
                  {destination.name || "Unnamed"}
                </Link>
                {destination.elevation != null ? (
                  <span className="shrink-0 text-xs text-muted">{formatFeet(destination.elevation)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {bundle.destinations.length > 0 ? (
          <section className="rounded-media border border-border bg-surface p-6">
            <SectionHeading>Destinations ({bundle.destinations.length})</SectionHeading>
            <ul className="mt-4 divide-y divide-hairline">
              {bundle.destinations.map((destination) => (
                <li key={destination.id}>
                  <Link
                    href={`/destinations/${destination.id}`}
                    className="group flex items-center justify-between gap-4 py-3"
                  >
                    <span className="font-medium text-ink group-hover:underline">
                      {destination.name || "Unnamed"}
                    </span>
                    {destination.elevation != null ? (
                      <span className="shrink-0 text-xs text-muted">{formatFeet(destination.elevation)}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bundle.routes.length > 0 ? (
          <section className="rounded-media border border-border bg-surface p-6">
            <SectionHeading>Routes ({bundle.routes.length})</SectionHeading>
            <ul className="mt-4 divide-y divide-hairline">
              {bundle.routes.map((route) => {
                const facts = [
                  route.distance != null ? formatMiles(route.distance) : null,
                  route.gain != null ? `${formatFeet(route.gain)} gain` : null,
                ].filter((fact): fact is string => Boolean(fact));
                const rowContent = (
                  <>
                    <span className={`font-medium text-ink ${route.isCatalog ? "group-hover:underline" : ""}`.trim()}>
                      {route.name || "Unnamed route"}
                    </span>
                    {facts.length > 0 ? (
                      <span className="shrink-0 text-xs text-muted">{facts.join(" · ")}</span>
                    ) : null}
                  </>
                );
                return (
                  <li key={route.id}>
                    {route.isCatalog ? (
                      <Link
                        href={catalogRoutePath(route.id)}
                        className="group flex items-center justify-between gap-4 py-3"
                      >
                        {rowContent}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-4 py-3">
                        {rowContent}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <p className="mt-8 text-xs leading-5 text-muted">
        Shared route pages do not include photos, health data, or party details.
      </p>
    </div>
  );
}
