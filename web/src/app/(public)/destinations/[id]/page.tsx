"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getDestination,
  getDestinationRoutes,
  getDestinationLists,
  getDestinationSessionCount,
  type DestinationDetail,
  type DestinationRoute,
  type DestinationList,
} from "@/lib/actions/destinations";
import { getTripReportsForDestination, type TripReport } from "@/lib/actions/trip-reports";

const DestinationMap = dynamic(() => import("@/components/destination-map"), {
  ssr: false,
});

export default function DestinationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [routes, setRoutes] = useState<DestinationRoute[]>([]);
  const [lists, setLists] = useState<DestinationList[]>([]);
  const [tripReports, setTripReports] = useState<TripReport[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [d, r, l, s, tr] = await Promise.all([
        getDestination(id),
        getDestinationRoutes(id),
        getDestinationLists(id),
        getDestinationSessionCount(id),
        getTripReportsForDestination(id, 5),
      ]);
      setDest(d);
      setRoutes(r);
      setLists(l);
      setSessionCount(s);
      setTripReports(tr);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!dest) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">
          Destination not found
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {dest.name || "Unnamed"}
        </span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{dest.name || "Unnamed"}</h1>
        {(dest.country_code || dest.state_code) && (
          <p className="text-sm text-gray-500 mt-1">
            {[dest.state_code, dest.country_code].filter(Boolean).join(", ")}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Elevation"
          value={
            dest.elevation
              ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
              : "\u2014"
          }
        />
        <StatCard
          label="Prominence"
          value={
            dest.prominence
              ? `${Math.round(dest.prominence * 3.28084).toLocaleString()} ft`
              : "\u2014"
          }
        />
        <StatCard label="Routes" value={routes.length.toString()} />
        <StatCard label="Sessions" value={sessionCount.toString()} />
      </div>

      {/* Hero Image */}
      {dest.hero_image && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dest.hero_image}
            alt={dest.name || "Destination"}
            className="w-full h-64 object-cover"
          />
          {dest.hero_image_attribution && (
            <div className="px-4 py-2 text-xs text-gray-500">
              Photo:{" "}
              {dest.hero_image_attribution_url ? (
                <a
                  href={dest.hero_image_attribution_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {dest.hero_image_attribution}
                </a>
              ) : (
                dest.hero_image_attribution
              )}
            </div>
          )}
        </div>
      )}

      {/* Map */}
      {dest.lat != null && dest.lng != null && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Location</h3>
          <DestinationMap lat={dest.lat} lng={dest.lng} name={dest.name} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">Details</h3>
          <dl className="space-y-3 text-sm">
            <DetailRow label="Type">
              <span className="capitalize">{dest.type}</span>
            </DetailRow>
            <DetailRow label="Features">
              <div className="flex flex-wrap gap-1 justify-end">
                {Array.isArray(dest.features) && dest.features.length > 0 ? (
                  dest.features.map((f) => (
                    <span
                      key={f}
                      className="inline-block px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                    >
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-400">&mdash;</span>
                )}
              </div>
            </DetailRow>
            {Array.isArray(dest.activities) && dest.activities.length > 0 && (
              <DetailRow label="Activities">
                <div className="flex flex-wrap gap-1 justify-end">
                  {dest.activities.map((a) => (
                    <span
                      key={a}
                      className="inline-block px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </DetailRow>
            )}
            <DetailRow label="Country">
              {dest.country_code || (
                <span className="text-gray-400">&mdash;</span>
              )}
            </DetailRow>
            <DetailRow label="State">
              {dest.state_code || (
                <span className="text-gray-400">&mdash;</span>
              )}
            </DetailRow>
            {dest.lat != null && dest.lng != null && (
              <DetailRow label="Coordinates">
                <span className="font-mono text-xs">
                  {dest.lat.toFixed(5)}, {dest.lng.toFixed(5)}
                </span>
              </DetailRow>
            )}
          </dl>
        </div>

        {/* Routes & Lists */}
        <div className="space-y-6">
          {/* Routes */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">Routes ({routes.length})</h3>
            {routes.length === 0 ? (
              <p className="text-sm text-gray-500">No routes linked</p>
            ) : (
              <div className="space-y-2">
                {routes.map((route) => (
                  <Link
                    key={route.id}
                    href={`/routes/${route.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {route.name || "Unnamed Route"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {route.distance
                          ? `${(route.distance / 1609.34).toFixed(1)} mi`
                          : ""}
                        {route.gain
                          ? ` \u00B7 ${Math.round(route.gain * 3.28084).toLocaleString()} ft gain`
                          : ""}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Lists */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">Lists ({lists.length})</h3>
            {lists.length === 0 ? (
              <p className="text-sm text-gray-500">Not in any lists</p>
            ) : (
              <div className="space-y-2">
                {lists.map((list) => (
                  <Link
                    key={list.id}
                    href={`/lists/${list.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {list.name || "Unnamed List"}
                      </div>
                      {list.description && (
                        <div className="text-xs text-gray-500 truncate max-w-xs">
                          {list.description}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {list.destination_count} dest.
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Trip Reports */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">
              Trip Reports ({tripReports.length})
            </h3>
            {tripReports.length === 0 ? (
              <p className="text-sm text-gray-500">No trip reports yet</p>
            ) : (
              <div className="space-y-2">
                {tripReports.slice(0, 3).map((report) => (
                  <Link
                    key={report.id}
                    href={`/reports/${report.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">{report.title}</div>
                      <div className="text-xs text-gray-500">
                        {report.userName} &middot;{" "}
                        {new Date(report.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                  </Link>
                ))}
                {tripReports.length > 3 && (
                  <Link
                    href={`/destinations/${id}/reports`}
                    className="inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mt-2"
                  >
                    View all trip reports
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
