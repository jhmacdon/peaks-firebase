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
  getNearbyDestinations,
  type SearchDestination,
} from "../../../../lib/actions/search";
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
import { summarizeRouteGuide, formatDurationRange } from "../../../../lib/route-guide";
import {
  Breadcrumb,
  DifficultyPill,
  SidePanel,
  StatCell,
  StatRow,
  titleize,
} from "../../../../components/detail-sections";
import type { Amenities } from "../../../../lib/amenities";
import { AreaChips } from "../../../../components/area-chip";

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
  const [nearby, setNearby] = useState<SearchDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
          getTripReportsForDestination(id, 5),
        ]);

        if (cancelled) return;

        setDest(d);
        setRoutes(r);
        setLists(l);
        setSessionCount(s);
        setTripReportCount(reportCount);
        setTripReports(tr);

        if (d?.lat != null && d?.lng != null) {
          const near = await getNearbyDestinations(d.lat, d.lng, 15000, 7);
          if (!cancelled) {
            setNearby(near.filter((n) => n.id !== id).slice(0, 6));
          }
        }
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
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="text-gray-500 py-16 text-center text-sm">Loading…</div>
        </div>
      </div>
    );
  }

  if (!dest) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="text-gray-500 py-16 text-center text-sm">
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
  const name = dest.name || "Unnamed";
  const locationParts = [dest.state_code, dest.country_code].filter(Boolean);
  const hasCoords = dest.lat != null && dest.lng != null;
  const mapLinks = hasCoords
    ? getDestinationMapLinks(dest.lat!, dest.lng!)
    : null;
  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`
    : null;
  const forecastUrl =
    hasCoords && dest.country_code === "US"
      ? `https://forecast.weather.gov/MapClick.php?lat=${dest.lat}&lon=${dest.lng}`
      : null;
  const coordText = hasCoords
    ? `${dest.lat!.toFixed(5)}, ${dest.lng!.toFixed(5)}`
    : null;

  const metaParts = [
    locationParts.length > 0 ? locationParts.join(", ") : null,
    dest.type === "region" ? "Region" : null,
    ...dest.features.map(titleize),
  ].filter(Boolean);

  const months = monthlyCounts(dest.averages);
  const facilities = dest.amenities ? amenityRows(dest.amenities) : [];

  function copyCoords() {
    if (!coordText) return;
    navigator.clipboard.writeText(coordText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumb current={name} />

        <header className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              {name}
            </h1>
            {metaParts.length > 0 && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {metaParts.join(" · ")}
              </p>
            )}
            <AreaChips areas={dest.areas} className="mt-2" />
          </div>
          <div className="flex shrink-0 gap-2">
            {directionsUrl && (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Directions
              </a>
            )}
            <Link
              href={`/reports/new?dest=${id}`}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Write a report
            </Link>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-5 dark:border-gray-800 dark:bg-gray-800">
          <StatCell label="Elevation" value={formatFeet(dest.elevation)} />
          <StatCell label="Prominence" value={formatFeet(dest.prominence)} />
          <StatCell label="Routes" value={routes.length.toLocaleString("en-US")} />
          <StatCell
            label="Trip reports"
            value={tripReportCount.toLocaleString("en-US")}
          />
          <StatCell label="Sessions" value={sessionCount.toLocaleString("en-US")} />
        </div>

        {dest.hero_image && (
          <figure className="mt-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dest.hero_image}
              alt={name}
              className="aspect-[21/9] w-full rounded-lg border border-gray-200 object-cover dark:border-gray-800"
            />
            {dest.hero_image_attribution && (
              <figcaption className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Photo:{" "}
                {dest.hero_image_attribution_url ? (
                  <a
                    href={dest.hero_image_attribution_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    {dest.hero_image_attribution}
                  </a>
                ) : (
                  dest.hero_image_attribution
                )}
              </figcaption>
            )}
          </figure>
        )}

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                About {name}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-gray-700 dark:text-gray-300">
                <p>{guide.headline}</p>
                {guide.paragraphs.map((paragraph, index) => (
                  <p key={`${index}-${paragraph}`}>{paragraph}</p>
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Map
              </h2>
              {hasCoords ? (
                <>
                  <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                    <DestinationMap
                      lat={dest.lat!}
                      lng={dest.lng!}
                      name={dest.name}
                      boundary={dest.boundary}
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <span className="font-mono text-[13px]">{coordText}</span>
                      <button
                        type="button"
                        onClick={copyCoords}
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="flex gap-4">
                      <a
                        href={mapLinks!.openStreetMap}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        OpenStreetMap
                      </a>
                      <a
                        href={mapLinks!.googleMaps}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Google Maps
                      </a>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  No coordinates are saved for this destination yet.
                </p>
              )}
            </section>

            <section className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Routes{routes.length > 0 ? ` (${routes.length})` : ""}
              </h2>
              {routes.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  No routes are linked to this destination yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {routes.map((route) => (
                    <RouteRow key={route.id} route={route} />
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Trip reports{tripReportCount > 0 ? ` (${tripReportCount})` : ""}
                </h2>
                <Link
                  href={`/reports/new?dest=${id}`}
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Write a report
                </Link>
              </div>
              {tripReports.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  No trip reports yet. Been here? Write the first one.
                </p>
              ) : (
                <>
                  <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                    {tripReports.map((report) => (
                      <li key={report.id} className="py-4">
                        <Link
                          href={`/reports/${report.id}`}
                          className="font-medium text-gray-900 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                        >
                          {report.title}
                        </Link>
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {report.userName} · {formatShortDate(report.date)}
                        </div>
                        {getReportPreview(report) && (
                          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                            {getReportPreview(report)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {tripReportCount > tripReports.length && (
                    <Link
                      href={`/destinations/${id}/reports`}
                      className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View all {tripReportCount} trip reports
                    </Link>
                  )}
                </>
              )}
            </section>
          </main>

          <aside className="space-y-6">
            <SidePanel title="Stats">
              <dl className="space-y-2">
                <StatRow label="Type" value={titleize(dest.type)} />
                <StatRow label="Elevation" value={formatFeet(dest.elevation)} />
                <StatRow label="Prominence" value={formatFeet(dest.prominence)} />
                <StatRow
                  label="Region"
                  value={locationParts.length > 0 ? locationParts.join(", ") : "—"}
                />
                <StatRow label="Coordinates" value={coordText || "—"} mono />
              </dl>
            </SidePanel>

            {(forecastUrl || directionsUrl || facilities.length > 0) && (
              <SidePanel title="Before you go">
                <ul className="space-y-1.5 text-sm">
                  {forecastUrl && (
                    <li>
                      <a
                        href={forecastUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        NOAA weather forecast
                      </a>
                    </li>
                  )}
                  {directionsUrl && (
                    <li>
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Driving directions
                      </a>
                    </li>
                  )}
                </ul>
                {facilities.length > 0 && (
                  <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Facilities
                    </div>
                    <dl className="mt-2 space-y-2">
                      {facilities.map((row) => (
                        <StatRow key={row.label} label={row.label} value={row.value} />
                      ))}
                    </dl>
                  </div>
                )}
              </SidePanel>
            )}

            {months && (
              <SidePanel title="Seasonality">
                <div className="flex h-16 items-end gap-1">
                  {months.map((count, i) => {
                    const max = Math.max(...months);
                    const pct = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-sm bg-blue-500/70 dark:bg-blue-400/60"
                        style={{ height: `${Math.max(pct, count > 0 ? 6 : 2)}%` }}
                        title={`${MONTH_NAMES[i]}: ${count}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-1 flex gap-1 text-center text-[10px] text-gray-400">
                  {MONTH_NAMES.map((m) => (
                    <div key={m} className="flex-1">
                      {m[0]}
                    </div>
                  ))}
                </div>
                {topMonths(months).length > 0 && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Most visits in {topMonths(months).join(" and ")}.
                  </p>
                )}
              </SidePanel>
            )}

            {lists.length > 0 && (
              <SidePanel title="On lists">
                <ul className="space-y-2 text-sm">
                  {lists.map((list) => (
                    <li key={list.id} className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/lists/${list.id}`}
                        className="min-w-0 truncate text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {list.name || "Unnamed List"}
                      </Link>
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {list.destination_count} destinations
                      </span>
                    </li>
                  ))}
                </ul>
              </SidePanel>
            )}

            {nearby.length > 0 && (
              <SidePanel title="Nearby">
                <ul className="space-y-2.5 text-sm">
                  {nearby.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={`/destinations/${n.id}`}
                        className="font-medium text-gray-900 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                      >
                        {n.name || "Unnamed"}
                      </Link>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {[
                          n.elevation != null ? formatFeet(n.elevation) : null,
                          n.distance_m != null ? formatDistanceAway(n.distance_m) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              </SidePanel>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_KEYS: string[][] = [
  ["jan", "january", "1", "01"],
  ["feb", "february", "2", "02"],
  ["mar", "march", "3", "03"],
  ["apr", "april", "4", "04"],
  ["may", "5", "05"],
  ["jun", "june", "6", "06"],
  ["jul", "july", "7", "07"],
  ["aug", "august", "8", "08"],
  ["sep", "sept", "september", "9", "09"],
  ["oct", "october", "10"],
  ["nov", "november", "11"],
  ["dec", "december", "12"],
];

function monthlyCounts(averages: DestinationDetail["averages"]): number[] | null {
  const source = averages?.months;
  if (!source || typeof source !== "object") return null;

  const byKey: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) {
    const count = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(count)) {
      byKey[key.toLowerCase()] = (byKey[key.toLowerCase()] || 0) + count;
    }
  }

  const counts = MONTH_KEYS.map((keys) =>
    keys.reduce((sum, key) => sum + (byKey[key] || 0), 0)
  );
  return counts.some((count) => count > 0) ? counts : null;
}

function topMonths(counts: number[]): string[] {
  const max = Math.max(...counts);
  if (max <= 0) return [];
  return counts
    .map((count, i) => ({ count, name: MONTH_NAMES[i] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .filter((m) => m.count > 0)
    .map((m) => m.name);
}

function formatDistanceAway(meters: number): string {
  if (meters < 1609.34) return `${Math.round(meters)} m away`;
  return `${(meters / 1609.34).toFixed(1)} mi away`;
}

function amenityRows(amenities: Amenities): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (amenities.toilet) {
    rows.push({
      label: "Toilet",
      value: amenities.toilet === "none" ? "None" : titleize(amenities.toilet),
    });
  }
  if (amenities.drinking_water) {
    rows.push({ label: "Drinking water", value: titleize(amenities.drinking_water) });
  }
  if (amenities.shower != null) {
    rows.push({ label: "Showers", value: amenities.shower ? "Yes" : "No" });
  }
  if (amenities.fee) {
    rows.push({
      label: "Fee",
      value: amenities.fee.required ? amenities.fee.amount || "Required" : "None",
    });
  }
  if (amenities.reservation) {
    rows.push({
      label: "Reservation",
      value:
        amenities.reservation === "no" ? "Not needed" : titleize(amenities.reservation),
    });
  }
  if (amenities.capacity != null) {
    rows.push({ label: "Capacity", value: String(amenities.capacity) });
  }
  if (amenities.fire_pit != null) {
    rows.push({ label: "Fire pit", value: amenities.fire_pit ? "Yes" : "No" });
  }
  if (amenities.backcountry != null) {
    rows.push({
      label: "Setting",
      value: amenities.backcountry ? "Backcountry" : "Frontcountry",
    });
  }
  return rows;
}

function getReportPreview(report: TripReport): string | null {
  const textBlock = report.blocks.find((block) => block.type === "text");
  const raw = textBlock?.content?.trim();
  if (!raw) return null;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

function RouteRow({ route }: { route: DestinationRoute }) {
  const hasStats = route.distance != null || route.gain != null;
  const summary = hasStats
    ? summarizeRouteGuide({
        distance: route.distance,
        gain: route.gain,
        gain_loss: null,
        shape: null,
        completion: "none",
        destination_count: 0,
      })
    : null;

  const metaParts = [
    route.distance != null ? formatMiles(route.distance) : null,
    route.gain != null ? `${formatFeet(route.gain)} gain` : null,
    summary?.estimatedHoursLow != null
      ? `Est. ${formatDurationRange(summary.estimatedHoursLow, summary.estimatedHoursHigh)}`
      : null,
  ].filter(Boolean);

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Link
          href={`/routes/${route.id}`}
          className="font-medium text-gray-900 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
        >
          {route.name || "Unnamed Route"}
        </Link>
        <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          {metaParts.length > 0 ? metaParts.join(" · ") : "No stats recorded"}
        </div>
      </div>
      {summary && <DifficultyPill label={summary.difficultyLabel} />}
    </li>
  );
}
