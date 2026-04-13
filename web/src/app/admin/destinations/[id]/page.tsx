"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminGuard from "../../../../components/admin-guard";
import AdminNav from "../../../../components/admin-nav";
import UserPopover from "../../../../components/user-popover";
import dynamic from "next/dynamic";
import {
  getDestination,
  getDestinationRoutes,
  getDestinationLists,
  getDestinationSessionCount,
  updateDestination,
  updateDestinationBoundary,
  deleteDestinationBoundary,
  reverseGeocodeDestination,
  type DestinationDetail,
  type DestinationRoute,
  type DestinationList,
} from "../../../../lib/actions/destinations";

const DestinationMap = dynamic(() => import("../../../../components/destination-map"), {
  ssr: false,
});

const BoundaryEditorMap = dynamic(() => import("../../../../components/boundary-editor-map"), {
  ssr: false,
});

export default function DestinationDetailPage() {
  return (
    <AdminGuard>
      <DestinationDetailContent />
    </AdminGuard>
  );
}

function DestinationDetailContent() {
  const params = useParams();
  const id = params.id as string;

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [routes, setRoutes] = useState<DestinationRoute[]>([]);
  const [lists, setLists] = useState<DestinationList[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editFeatures, setEditFeatures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [pendingBoundary, setPendingBoundary] = useState<GeoJSON.Polygon | null>(null);
  const [savingBoundary, setSavingBoundary] = useState(false);

  useEffect(() => {
    async function load() {
      const [d, r, l, s] = await Promise.all([
        getDestination(id),
        getDestinationRoutes(id),
        getDestinationLists(id),
        getDestinationSessionCount(id),
      ]);
      setDest(d);
      setRoutes(r);
      setLists(l);
      setSessionCount(s);
      if (d) {
        setEditName(d.name || "");
        setEditType(d.type);
        setEditFeatures(Array.isArray(d.features) ? [...d.features] : []);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    await updateDestination(id, { name: editName, type: editType, features: editFeatures });
    setDest((prev) =>
      prev ? { ...prev, name: editName, type: editType, features: editFeatures } : prev
    );
    setEditing(false);
    setSaving(false);
  };

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const result = await reverseGeocodeDestination(id);
      setDest((prev) =>
        prev
          ? {
              ...prev,
              country_code: result.country_code || prev.country_code,
              state_code: result.state_code || prev.state_code,
            }
          : prev
      );
    } catch (err: unknown) {
      console.error("Geocoding failed:", err);
    } finally {
      setGeocoding(false);
    }
  };

  const handleSaveBoundary = async () => {
    if (!pendingBoundary) return;
    setSavingBoundary(true);
    await updateDestinationBoundary(id, pendingBoundary);
    setDest((prev) => prev ? { ...prev, boundary: pendingBoundary } : prev);
    setEditingBoundary(false);
    setPendingBoundary(null);
    setSavingBoundary(false);
  };

  const handleDeleteBoundary = async () => {
    setSavingBoundary(true);
    await deleteDestinationBoundary(id);
    setDest((prev) => prev ? { ...prev, boundary: null } : prev);
    setEditingBoundary(false);
    setPendingBoundary(null);
    setSavingBoundary(false);
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

  if (!dest) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">
            Destination not found
          </div>
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
          <Link
            href="/admin/destinations"
            className="hover:text-gray-900 dark:hover:text-gray-100"
          >
            Destinations
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">
            {dest.name || "Unnamed"}
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
                {dest.name || "Unnamed"}
              </h2>
            )}
            <p className="text-sm text-gray-500 mt-1 font-mono">{dest.id}</p>
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

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Elevation"
            value={
              dest.elevation
                ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard
            label="Prominence"
            value={
              dest.prominence
                ? `${Math.round(dest.prominence * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard label="Routes" value={routes.length.toString()} />
          <StatCard
            label="Sessions"
            value={sessionCount.toString()}
            href={sessionCount > 0 ? `/admin/sessions?destination=${id}` : undefined}
          />
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
                Photo: {dest.hero_image_attribution_url ? (
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

        {/* Map + Boundary */}
        {dest.lat != null && dest.lng != null && (
          <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Location</h3>
              <div className="flex items-center gap-2">
                {dest.boundary && !editingBoundary && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    Boundary set
                  </span>
                )}
                {editingBoundary ? (
                  <>
                    <button
                      onClick={() => { setEditingBoundary(false); setPendingBoundary(null); }}
                      className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    {(dest.boundary || pendingBoundary) && (
                      <button
                        onClick={handleDeleteBoundary}
                        disabled={savingBoundary}
                        className="text-xs px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors"
                      >
                        Clear Boundary
                      </button>
                    )}
                    <button
                      onClick={handleSaveBoundary}
                      disabled={!pendingBoundary || savingBoundary}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {savingBoundary ? "Saving..." : "Save Boundary"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditingBoundary(true); setPendingBoundary(null); }}
                    className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    {dest.boundary ? "Edit Boundary" : "Draw Boundary"}
                  </button>
                )}
              </div>
            </div>
            {editingBoundary ? (
              <BoundaryEditorMap
                lat={dest.lat}
                lng={dest.lng}
                name={dest.name}
                boundary={dest.boundary}
                onBoundaryChange={setPendingBoundary}
              />
            ) : (
              <DestinationMap lat={dest.lat} lng={dest.lng} name={dest.name} boundary={dest.boundary} />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">Details</h3>
            <dl className="space-y-3 text-sm">
              <DetailRow label="Type">
                {editing ? (
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-transparent text-sm"
                  >
                    <option value="point">Point</option>
                    <option value="region">Region</option>
                  </select>
                ) : (
                  <span className="capitalize">{dest.type}</span>
                )}
              </DetailRow>
              <DetailRow label="Owner">
                {dest.owner === "peaks" ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    Peaks (system)
                  </span>
                ) : (
                  <UserPopover uid={dest.owner} />
                )}
              </DetailRow>
              <DetailRow label="Features">
                {editing ? (
                  <div className="flex flex-wrap gap-1.5 justify-end items-center">
                    {editFeatures.map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                      >
                        {f}
                        <button
                          onClick={() => setEditFeatures((fs) => fs.filter((x) => x !== f))}
                          className="text-green-500 hover:text-red-500 ml-0.5"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !editFeatures.includes(e.target.value)) {
                          setEditFeatures((fs) => [...fs, e.target.value]);
                        }
                      }}
                      className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-700 rounded bg-transparent"
                    >
                      <option value="">+ Add</option>
                      {["summit", "trailhead", "volcano", "fire-lookout", "hut", "lookout", "lake"]
                        .filter((f) => !editFeatures.includes(f))
                        .map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                    </select>
                  </div>
                ) : (
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
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                )}
              </DetailRow>
              {(Array.isArray(dest.activities) && dest.activities.length > 0) && (
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
                {dest.country_code || <span className="text-gray-400">—</span>}
              </DetailRow>
              <DetailRow label="State">
                {dest.state_code || <span className="text-gray-400">—</span>}
              </DetailRow>
              {(!dest.country_code || !dest.state_code) && dest.lat != null && dest.lng != null && (
                <div className="pt-1">
                  <button
                    onClick={handleGeocode}
                    disabled={geocoding}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {geocoding ? "Looking up..." : "Populate Location Data"}
                  </button>
                </div>
              )}
              {dest.lat != null && dest.lng != null && (
                <DetailRow label="Coordinates">
                  <span className="font-mono text-xs">
                    {dest.lat.toFixed(5)}, {dest.lng.toFixed(5)}
                  </span>
                </DetailRow>
              )}
              {dest.geohash && (
                <DetailRow label="Geohash">
                  <span className="font-mono text-xs">{dest.geohash}</span>
                </DetailRow>
              )}
              <DetailRow label="Created">
                {new Date(dest.created_at).toLocaleDateString()}
              </DetailRow>
              <DetailRow label="Updated">
                {new Date(dest.updated_at).toLocaleDateString()}
              </DetailRow>
            </dl>
          </div>

          {/* Routes & Lists */}
          <div className="space-y-6">
            {/* Routes */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-4">
                Routes ({routes.length})
              </h3>
              {routes.length === 0 ? (
                <p className="text-sm text-gray-500">No routes linked</p>
              ) : (
                <div className="space-y-2">
                  {routes.map((route) => (
                    <Link
                      key={route.id}
                      href={`/admin/routes/${route.id}`}
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
                            ? ` · ${Math.round(route.gain * 3.28084).toLocaleString()} ft gain`
                            : ""}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">
                        #{route.ordinal}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Lists */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-4">
                Lists ({lists.length})
              </h3>
              {lists.length === 0 ? (
                <p className="text-sm text-gray-500">Not in any lists</p>
              ) : (
                <div className="space-y-2">
                  {lists.map((list) => (
                    <Link
                      key={list.id}
                      href={`/admin/lists/${list.id}`}
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
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
      >
        {content}
      </Link>
    );
  }
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      {content}
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
