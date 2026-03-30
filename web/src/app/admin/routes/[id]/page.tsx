"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";
import dynamic from "next/dynamic";
import {
  getRoute,
  getRouteDestinations,
  getRouteSegments,
  getRouteSessionCount,
  updateRoute,
  acceptRoute,
  rejectRoute,
  type RouteDetail,
  type RouteDestination,
  type RouteSegment,
} from "@/lib/actions/routes";
import UserPopover from "@/components/user-popover";

const RouteMap = dynamic(() => import("@/components/route-map"), { ssr: false });

export default function RouteDetailPage() {
  return (
    <AdminGuard>
      <RouteDetailContent />
    </AdminGuard>
  );
}

function RouteDetailContent() {
  const params = useParams();
  const id = params.id as string;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCompletion, setEditCompletion] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewAction, setReviewAction] = useState<"accepting" | "rejecting" | null>(null);

  useEffect(() => {
    async function load() {
      const [r, dests, segs, sessions] = await Promise.all([
        getRoute(id),
        getRouteDestinations(id),
        getRouteSegments(id),
        getRouteSessionCount(id),
      ]);
      setRoute(r);
      setDestinations(dests);
      setSegments(segs);
      setSessionCount(sessions);
      if (r) {
        setEditName(r.name || "");
        setEditCompletion(r.completion);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    await updateRoute(id, { name: editName, completion: editCompletion });
    setRoute((prev) =>
      prev ? { ...prev, name: editName, completion: editCompletion } : prev
    );
    setEditing(false);
    setSaving(false);
  };

  const handleAccept = async () => {
    setReviewAction("accepting");
    await acceptRoute(id);
    setRoute((prev) => prev ? { ...prev, status: "active" } : prev);
    setReviewAction(null);
  };

  const handleReject = async () => {
    if (!confirm("Delete this pending route? This cannot be undone.")) return;
    setReviewAction("rejecting");
    await rejectRoute(id);
    window.location.href = "/admin/routes";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </main>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Route not found</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/admin/routes" className="hover:text-gray-900 dark:hover:text-gray-100">
            Routes
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">
            {route.name || "Unnamed Route"}
          </span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            {editing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-2xl font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none pb-1"
                autoFocus
              />
            ) : (
              <h2 className="text-2xl font-semibold">
                {route.name || "Unnamed Route"}
              </h2>
            )}
            <p className="text-sm text-gray-500 mt-1 font-mono">{route.id}</p>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Pending Review Banner */}
        {route.status === "pending" && (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between">
            <div>
              <div className="font-medium text-amber-800 dark:text-amber-200">
                Pending Review
              </div>
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
                This route was imported and needs review before it goes live.
              </p>
            </div>
            <div className="flex gap-2 shrink-0 ml-4">
              <button
                onClick={handleReject}
                disabled={reviewAction !== null}
                className="px-4 py-2 text-sm border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors"
              >
                {reviewAction === "rejecting" ? "Rejecting..." : "Reject"}
              </button>
              <button
                onClick={handleAccept}
                disabled={reviewAction !== null}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {reviewAction === "accepting" ? "Accepting..." : "Accept Route"}
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Distance"
            value={
              route.distance
                ? `${(route.distance / 1609.34).toFixed(1)} mi`
                : "—"
            }
          />
          <StatCard
            label="Elevation Gain"
            value={
              route.gain
                ? `${Math.round(route.gain * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard
            label="Elevation Loss"
            value={
              route.gain_loss
                ? `${Math.round(route.gain_loss * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard label="Sessions" value={sessionCount.toString()} />
        </div>

        {/* Map */}
        {route.polyline6 && (
          <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="font-semibold mb-3">Route Map</h3>
            <RouteMap polyline6={route.polyline6} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">Details</h3>
            <dl className="space-y-3 text-sm">
              <DetailRow label="Owner">
                {route.owner === "peaks" ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    Peaks (system)
                  </span>
                ) : (
                  <UserPopover uid={route.owner} />
                )}
              </DetailRow>
              <DetailRow label="Shape">
                <span className="capitalize">{route.shape?.replace(/_/g, " ") || "—"}</span>
              </DetailRow>
              <DetailRow label="Completion">
                {editing ? (
                  <select
                    value={editCompletion}
                    onChange={(e) => setEditCompletion(e.target.value)}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-transparent text-sm"
                  >
                    <option value="none">None</option>
                    <option value="straight">Straight</option>
                    <option value="reverse">Reverse</option>
                  </select>
                ) : (
                  <span className="capitalize">{route.completion}</span>
                )}
              </DetailRow>
              {route.elevation_string && (
                <DetailRow label="Elevation">{route.elevation_string}</DetailRow>
              )}
              {route.external_links && route.external_links.length > 0 && (
                <DetailRow label="External Links">
                  <div className="flex gap-2">
                    {route.external_links.map((link: { type: string; id: string }, i: number) => (
                      <span
                        key={i}
                        className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800"
                      >
                        {link.type.toUpperCase()}: {link.id}
                      </span>
                    ))}
                  </div>
                </DetailRow>
              )}
              <DetailRow label="Created">
                {new Date(route.created_at).toLocaleDateString()}
              </DetailRow>
              <DetailRow label="Updated">
                {new Date(route.updated_at).toLocaleDateString()}
              </DetailRow>
              {route.polyline6 && (
                <DetailRow label="Polyline">
                  <span className="text-xs text-gray-400 font-mono truncate block max-w-xs">
                    {route.polyline6.slice(0, 60)}...
                  </span>
                </DetailRow>
              )}
            </dl>
          </div>

          {/* Destinations */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">
              Destinations ({destinations.length})
            </h3>
            {destinations.length === 0 ? (
              <p className="text-sm text-gray-500">No destinations linked</p>
            ) : (
              <div className="space-y-2">
                {destinations.map((dest) => (
                  <Link
                    key={dest.id}
                    href={`/admin/destinations/${dest.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {dest.name || "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {dest.elevation
                          ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                          : ""}
                        {Array.isArray(dest.features) && dest.features.length > 0 &&
                          ` · ${dest.features.join(", ")}`}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">#{dest.ordinal}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Segments */}
        {segments.length > 0 && (
          <div className="mt-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">
              Segments ({segments.length})
            </h3>
            <div className="space-y-2">
              {segments.map((seg) => (
                <div
                  key={`${seg.id}-${seg.ordinal}`}
                  className="flex items-center gap-4 p-3 rounded-lg border border-gray-100 dark:border-gray-800"
                >
                  <span className="text-xs text-gray-400 font-mono w-6 text-center shrink-0">
                    {seg.ordinal}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {seg.name || "Unnamed Segment"}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {seg.distance != null && (
                        <span>{(seg.distance / 1609.34).toFixed(1)} mi</span>
                      )}
                      {seg.gain != null && (
                        <span>{Math.round(seg.gain * 3.28084).toLocaleString()} ft gain</span>
                      )}
                      {seg.gain_loss != null && (
                        <span>{Math.round(seg.gain_loss * 3.28084).toLocaleString()} ft loss</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {seg.direction === "reverse" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-medium">
                        Reversed
                      </span>
                    )}
                    {seg.route_count > 1 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 font-medium">
                        {seg.route_count} routes
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 font-mono shrink-0" title={seg.id}>
                    {seg.id.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
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
