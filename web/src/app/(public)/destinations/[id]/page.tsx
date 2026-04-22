"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  getDestination,
  getDestinationRoutes,
  getDestinationLists,
  getDestinationSessionCount,
  type DestinationDetail,
  type DestinationRoute,
  type DestinationList,
} from "../../../../lib/actions/destinations";
import {
  getTripReportsForDestination,
  getTripReportCountForDestination,
  type TripReport,
} from "../../../../lib/actions/trip-reports";
import {
  buildDestinationGuide,
  formatFeet,
  formatMiles,
  formatShortDate,
  getDestinationMapLinks,
} from "../../../../lib/destination-detail";

const DestinationMap = dynamic(() => import("../../../../components/destination-map"), {
  ssr: false,
});

export default function DestinationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [routes, setRoutes] = useState<DestinationRoute[]>([]);
  const [lists, setLists] = useState<DestinationList[]>([]);
  const [tripReports, setTripReports] = useState<TripReport[]>([]);
  const [tripReportCount, setTripReportCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [d, r, l, s, reportCount, tr] = await Promise.all([
          getDestination(id),
          getDestinationRoutes(id, { publicOnly: true }),
          getDestinationLists(id),
          getDestinationSessionCount(id),
          getTripReportCountForDestination(id),
          getTripReportsForDestination(id, 8),
        ]);

        if (cancelled) return;

        setDest(d);
        setRoutes(r);
        setLists(l);
        setSessionCount(s);
        setTripReportCount(reportCount);
        setTripReports(tr);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </div>
      </div>
    );
  }

  if (!dest) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">
            Destination not found
          </div>
        </div>
      </div>
    );
  }

  const guide = buildDestinationGuide(
    dest,
    routes.length,
    lists.length,
    sessionCount,
    tripReportCount
  );
  const locationParts = [dest.state_code, dest.country_code].filter(Boolean);
  const mapLinks =
    dest.lat != null && dest.lng != null
      ? getDestinationMapLinks(dest.lat, dest.lng)
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-6 py-8 lg:py-10">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/discover" className="hover:text-gray-900 dark:hover:text-gray-100">
            Discover
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">
            {dest.name || "Unnamed"}
          </span>
        </div>

        <section className="relative overflow-hidden rounded-3xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.08),transparent_24%)]" />
              <div className="relative">
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    Public guide
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    {dest.type}
                  </span>
                  {dest.explicitly_saved && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Saved
                    </span>
                  )}
                </div>

                <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {dest.name || "Unnamed"}
                </h1>

                {locationParts.length > 0 && (
                  <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-300">
                    {locationParts.join(", ")}
                  </p>
                )}

                <div className="mt-6 max-w-2xl space-y-3 text-sm sm:text-base leading-7 text-slate-700 dark:text-slate-300">
                  <p>{guide.headline}</p>
                  {guide.paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph}`}>{paragraph}</p>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    href={mapLinks?.googleMaps || "#"}
                    external={!!mapLinks}
                    disabled={!mapLinks}
                    variant="primary"
                  >
                    Open map
                  </ActionButton>
                  <ActionButton href={`/destinations/${id}/reports`}>
                    Trip reports
                  </ActionButton>
                  <ActionButton href={`/reports/new?dest=${id}`}>
                    Write a report
                  </ActionButton>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {guide.badges.slice(0, 8).map((badge) => (
                    <span
                      key={badge}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative min-h-[280px] bg-slate-950">
              {dest.hero_image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={dest.hero_image}
                    alt={dest.name || "Destination"}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                    <div className="max-w-md rounded-2xl border border-white/15 bg-slate-950/45 p-4 text-sm text-white/90 backdrop-blur">
                      <div className="font-medium text-white">Photo context</div>
                      <p className="mt-1">
                        {dest.hero_image_attribution ? (
                          dest.hero_image_attribution_url ? (
                            <a
                              href={dest.hero_image_attribution_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-white/40 underline-offset-2 hover:decoration-white"
                            >
                              {dest.hero_image_attribution}
                            </a>
                          ) : (
                            dest.hero_image_attribution
                          )
                        ) : (
                          "Hero image supplied with the destination record."
                        )}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-end bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.35),transparent_30%),linear-gradient(160deg,#0f172a_0%,#111827_45%,#020617_100%)] p-6 text-white">
                  <div className="max-w-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-200/80">
                      No hero image
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-200">
                      The guide still includes the map, linked routes, lists, and
                      reports so the destination is fully explorable.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Elevation" value={formatFeet(dest.elevation)} />
          <StatCard label="Prominence" value={formatFeet(dest.prominence)} />
          <StatCard label="Routes" value={routes.length.toLocaleString("en-US")} />
          <StatCard label="Lists" value={lists.length.toLocaleString("en-US")} />
          <StatCard
            label="Trip reports"
            value={tripReportCount.toLocaleString("en-US")}
          />
          <StatCard
            label="Sessions"
            value={sessionCount.toLocaleString("en-US")}
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <div className="space-y-6">
            <SectionCard
              title="Location"
              description="Map, coordinates, and external map links."
            >
              {dest.lat != null && dest.lng != null ? (
                <>
                  <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                    <DestinationMap
                      lat={dest.lat}
                      lng={dest.lng}
                      name={dest.name}
                      boundary={dest.boundary}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <InfoBlock
                      label="Region"
                      value={
                        locationParts.length > 0
                          ? locationParts.join(", ")
                          : "Not set"
                      }
                    />
                    <InfoBlock
                      label="Coordinates"
                      value={`${dest.lat.toFixed(5)}, ${dest.lng.toFixed(5)}`}
                    />
                    <InfoBlock
                      label="Boundary"
                      value={dest.boundary ? "Polygon available" : "No boundary saved"}
                    />
                    <InfoBlock
                      label="Type"
                      value={dest.type}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {mapLinks && (
                      <>
                        <ExternalButton href={mapLinks.openStreetMap}>
                          OpenStreetMap
                        </ExternalButton>
                        <ExternalButton href={mapLinks.googleMaps}>
                          Google Maps
                        </ExternalButton>
                      </>
                    )}
                    <ActionButton href={`/destinations/${id}/reports`}>
                      Browse trip reports
                    </ActionButton>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
                  No coordinates are saved for this destination yet.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Guide notes"
              description="Generated from the destination record, linked routes, lists, sessions, and reports."
            >
              <div className="space-y-3 text-sm leading-7 text-gray-700 dark:text-gray-300">
                {guide.paragraphs.length > 0 ? (
                  guide.paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph}`}>{paragraph}</p>
                  ))
                ) : (
                  <p>
                    This destination has a sparse record, but the linked map and
                    related content still provide a useful starting point.
                  </p>
                )}
              </div>

              {(guide.seasonalMonths.length > 0 || guide.seasonalDays.length > 0) && (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {guide.seasonalMonths.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                        Top months
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {guide.seasonalMonths.slice(0, 4).map((item) => (
                          <span
                            key={item.label}
                            className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                          >
                            {item.label} · {item.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {guide.seasonalDays.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                        Top days
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {guide.seasonalDays.slice(0, 4).map((item) => (
                          <span
                            key={item.label}
                            className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            {item.label} · {item.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title={`Routes (${routes.length})`}
              description="Linked route references with distance and gain context."
            >
              {routes.length === 0 ? (
                <EmptyState text="No routes linked to this destination yet." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {routes.map((route) => (
                    <Link
                      key={route.id}
                      href={`/routes/${route.id}`}
                      className="group rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-950 dark:text-white">
                            {route.name || "Unnamed Route"}
                          </div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {route.distance != null ? formatMiles(route.distance) : "Distance not set"}
                            {route.gain != null ? ` · ${formatFeet(route.gain)} gain` : ""}
                          </div>
                        </div>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          Open
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Planning context"
              description="A quick read on how much public content exists here."
            >
              <div className="space-y-3">
                <PlanningRow label="Routes" value={routes.length.toString()} />
                <PlanningRow label="Lists" value={lists.length.toString()} />
                <PlanningRow label="Trip reports" value={tripReportCount.toString()} />
                <PlanningRow label="Sessions" value={sessionCount.toString()} />
              </div>

              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                {tripReportCount > 0
                  ? "Trip reports and list placements suggest there is meaningful public context around this destination."
                  : "This destination currently has limited report coverage, so the map and linked route data do most of the work."}
              </div>
            </SectionCard>

            <SectionCard
              title={`Lists (${lists.length})`}
              description="Curated lists that include this destination."
            >
              {lists.length === 0 ? (
                <EmptyState text="Not in any lists yet." />
              ) : (
                <div className="space-y-3">
                  {lists.map((list) => (
                    <Link
                      key={list.id}
                      href={`/lists/${list.id}`}
                      className="block rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-950 dark:text-white">
                            {list.name || "Unnamed List"}
                          </div>
                          {list.description && (
                            <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                              {list.description}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          {list.destination_count} destinations
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Recent trip reports"
              description="Recent public trip reports that mention this destination."
              action={
                <Link
                  href={`/destinations/${id}/reports`}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  View all
                </Link>
              }
            >
              {tripReports.length === 0 ? (
                <EmptyState text="No trip reports yet." />
              ) : (
                <div className="space-y-3">
                  {tripReports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/reports/${report.id}`}
                      className="block rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-950 dark:text-white">
                            {report.title}
                          </div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {report.userName} · {formatShortDate(report.date)}
                          </div>
                          {getReportPreview(report) && (
                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-700 dark:text-gray-300">
                              {getReportPreview(report)}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Read
                        </span>
                      </div>
                    </Link>
                  ))}

                  <Link
                    href={`/destinations/${id}/reports`}
                    className="inline-flex text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Browse the full report collection
                  </Link>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function getReportPreview(report: TripReport): string | null {
  const textBlock = report.blocks.find((block) => block.type === "text");
  const raw = textBlock?.content?.trim();
  if (!raw) return null;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950 dark:text-white">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-2xl font-semibold text-gray-950 dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-gray-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function PlanningRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-950">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-950 dark:text-white">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
      {text}
    </div>
  );
}

function ActionButton({
  href,
  children,
  external = false,
  disabled = false,
  variant = "secondary",
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "inline-flex items-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      : "inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-700 dark:hover:text-blue-300";

  if (disabled) {
    return (
      <span className={`${className} cursor-not-allowed opacity-50`}>
        {children}
      </span>
    );
  }

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function ExternalButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-700 dark:hover:text-blue-300"
    >
      {children}
    </a>
  );
}
