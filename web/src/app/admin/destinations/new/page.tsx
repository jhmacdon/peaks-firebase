"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AdminGuard from "../../../../components/admin-guard";
import AdminNav from "../../../../components/admin-nav";
import {
  searchNearbyExisting,
  searchOSMNearby,
  createDestination,
  updateDestinationBoundary,
  lookupElevation,
  type NearbyDestination,
  type OSMSuggestion,
} from "../../../../lib/actions/destinations";

const DestinationSearchMap = dynamic(
  () => import("../../../../components/destination-search-map"),
  { ssr: false }
);
const LocationPickerMap = dynamic(
  () => import("../../../../components/location-picker-map"),
  { ssr: false }
);
const BoundaryEditorMap = dynamic(
  () => import("../../../../components/boundary-editor-map"),
  { ssr: false }
);

type Step = "pick" | "confirm";

interface ConfirmData {
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  features: string[];
  type: string;
  source: string;
}

interface Toast {
  id: string;
  name: string;
  destId: string;
}

const ALL_FEATURES = [
  "summit",
  "trailhead",
  "volcano",
  "fire-lookout",
  "hut",
  "lookout",
  "lake",
] as const;

const TOAST_DURATION = 8000;

export default function NewDestinationPage() {
  return (
    <AdminGuard>
      <NewDestinationContent />
    </AdminGuard>
  );
}

function NewDestinationContent() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");

  // Map / search state
  const [clickedPoint, setClickedPoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [existing, setExisting] = useState<NearbyDestination[]>([]);
  const [osmResults, setOsmResults] = useState<OSMSuggestion[]>([]);

  // Confirm state
  const [confirm, setConfirm] = useState<ConfirmData | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookingUpElevation, setLookingUpElevation] = useState(false);
  const [boundary, setBoundary] = useState<GeoJSON.Polygon | null>(null);
  const [showBoundaryEditor, setShowBoundaryEditor] = useState(false);

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      setClickedPoint({ lat, lng });
      setSearching(true);
      setExisting([]);
      setOsmResults([]);

      const [db, osm] = await Promise.all([
        searchNearbyExisting(lat, lng),
        searchOSMNearby(lat, lng),
      ]);

      setExisting(db);
      setOsmResults(osm);
      setSearching(false);
    },
    []
  );

  const handleSelectOSM = (s: OSMSuggestion) => {
    setConfirm({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      elevation: s.elevation,
      features: s.feature ? [s.feature] : [],
      type: "point",
      source: `OSM (${s.osm_tags})`,
    });
    setBoundary(null);
    setShowBoundaryEditor(false);
    setStep("confirm");
  };

  const handleSelectExisting = (d: NearbyDestination) => {
    router.push(`/admin/destinations/${d.id}`);
  };

  const handleCreateCustom = () => {
    if (!clickedPoint) return;
    setConfirm({
      name: "",
      lat: clickedPoint.lat,
      lng: clickedPoint.lng,
      elevation: null,
      features: [],
      type: "point",
      source: "Manual",
    });
    setBoundary(null);
    setShowBoundaryEditor(false);
    setStep("confirm");
  };

  const handleLookupElevation = async () => {
    if (!confirm) return;
    setLookingUpElevation(true);
    try {
      const ele = await lookupElevation(confirm.lat, confirm.lng);
      if (ele != null) {
        setConfirm({ ...confirm, elevation: ele });
      }
    } catch {
      // silent
    } finally {
      setLookingUpElevation(false);
    }
  };

  const handleSave = async () => {
    if (!confirm || !confirm.name.trim()) return;
    setSaving(true);
    try {
      const result = await createDestination({
        name: confirm.name.trim(),
        lat: confirm.lat,
        lng: confirm.lng,
        elevation: confirm.elevation,
        features: confirm.features,
        type: confirm.type,
      });
      if (boundary) {
        await updateDestinationBoundary(result.id, boundary);
      }
      const name = confirm.name.trim();
      setToasts((prev) => [
        ...prev,
        { id: result.id, name, destId: result.id },
      ]);
      setConfirm(null);
      setBoundary(null);
      setShowBoundaryEditor(false);
      setStep("pick");
      setSaving(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create destination");
      setSaving(false);
    }
  };

  const mapMarkers = [
    ...existing.map((d) => ({
      lat: d.lat,
      lng: d.lng,
      name: `${d.name || "Unnamed"} (${d.distance}m)`,
      color: "#2563eb",
    })),
    ...osmResults.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      name: `${s.name} (${s.distance}m)`,
      color: "#16a34a",
    })),
  ];

  if (step === "confirm" && confirm) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Link
              href="/admin/destinations"
              className="hover:text-gray-900 dark:hover:text-gray-100"
            >
              Destinations
            </Link>
            <span>/</span>
            <button
              onClick={() => setStep("pick")}
              className="hover:text-gray-900 dark:hover:text-gray-100"
            >
              Search
            </button>
            <span>/</span>
            <span className="text-gray-900 dark:text-gray-100">
              Confirm
            </span>
          </div>

          <h2 className="text-2xl font-semibold mb-2">Add Destination</h2>
          <p className="text-sm text-gray-500 mb-6">
            Source: {confirm.source}
          </p>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={confirm.name}
                onChange={(e) =>
                  setConfirm({ ...confirm, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={confirm.type}
                onChange={(e) =>
                  setConfirm({ ...confirm, type: e.target.value })
                }
                className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
              >
                <option value="point">Point</option>
                <option value="region">Region</option>
              </select>
            </div>

            {/* Features */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Features
              </label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {confirm.features.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  >
                    {f}
                    <button
                      onClick={() =>
                        setConfirm({
                          ...confirm,
                          features: confirm.features.filter((x) => x !== f),
                        })
                      }
                      className="text-green-500 hover:text-red-500 ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !confirm.features.includes(e.target.value)
                    ) {
                      setConfirm({
                        ...confirm,
                        features: [...confirm.features, e.target.value],
                      });
                    }
                  }}
                  className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-transparent"
                >
                  <option value="">+ Add feature</option>
                  {ALL_FEATURES.filter(
                    (f) => !confirm.features.includes(f)
                  ).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Elevation */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Elevation
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={
                    confirm.elevation != null
                      ? Math.round(confirm.elevation * 3.28084)
                      : ""
                  }
                  onChange={(e) =>
                    setConfirm({
                      ...confirm,
                      elevation: e.target.value
                        ? Math.round(parseFloat(e.target.value) / 3.28084)
                        : null,
                    })
                  }
                  placeholder="—"
                  className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">ft</span>
                <button
                  onClick={handleLookupElevation}
                  disabled={lookingUpElevation}
                  className="text-xs px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {lookingUpElevation ? "Looking up..." : "Auto-fill"}
                </button>
              </div>
              {confirm.elevation != null && (
                <p className="text-xs text-gray-400 mt-1">
                  {Math.round(confirm.elevation)}m
                </p>
              )}
            </div>

            {/* Location */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">
                  Location
                </label>
                <span className="text-xs text-gray-400 font-mono">
                  {confirm.lat.toFixed(5)}, {confirm.lng.toFixed(5)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Drag the marker to adjust the exact position
              </p>
              <LocationPickerMap
                lat={confirm.lat}
                lng={confirm.lng}
                onChange={(lat, lng) =>
                  setConfirm({ ...confirm, lat, lng })
                }
              />
            </div>

            {/* Boundary */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">
                  Boundary
                </label>
                <div className="flex items-center gap-2">
                  {boundary && !showBoundaryEditor && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      Boundary set
                    </span>
                  )}
                  {showBoundaryEditor ? (
                    <button
                      onClick={() => setShowBoundaryEditor(false)}
                      className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowBoundaryEditor(true)}
                      className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      {boundary ? "Edit Boundary" : "Draw Boundary"}
                    </button>
                  )}
                </div>
              </div>
              {showBoundaryEditor && (
                <BoundaryEditorMap
                  lat={confirm.lat}
                  lng={confirm.lng}
                  name={confirm.name || undefined}
                  boundary={boundary}
                  onBoundaryChange={setBoundary}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep("pick")}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !confirm.name.trim()}
                className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Creating..." : "Create Destination"}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step: pick location
  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <div className="flex items-center gap-2 text-sm text-gray-500 px-6 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <Link
          href="/admin/destinations"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Destinations
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          Add Destination
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          <DestinationSearchMap
            onClick={handleMapClick}
            clickedPoint={clickedPoint}
            markers={mapMarkers}
          />
          {!clickedPoint && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/90 dark:bg-gray-900/90 rounded-lg shadow text-sm text-gray-700 dark:text-gray-300 pointer-events-none backdrop-blur-sm">
              Click anywhere on the map to search for nearby destinations
            </div>
          )}

          {/* Toasts */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-[1000]">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 animate-[fadeIn_0.2s_ease-out]"
              >
                <span className="text-green-600 dark:text-green-400 text-sm font-medium shrink-0">
                  Created
                </span>
                <Link
                  href={`/admin/destinations/${t.destId}`}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium truncate max-w-[200px]"
                >
                  {t.name}
                </Link>
                <button
                  onClick={() => dismissToast(t.id)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 text-lg leading-none"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Results panel */}
        {clickedPoint && (
          <div className="w-96 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold text-sm">
                Nearby Destinations
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 font-mono">
                {clickedPoint.lat.toFixed(5)}, {clickedPoint.lng.toFixed(5)}
              </p>
            </div>

            {searching ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Searching...
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* Existing in DB */}
                {existing.length > 0 && (
                  <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      In your database
                    </h4>
                    <div className="space-y-1.5">
                      {existing.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => handleSelectExisting(d)}
                          className="w-full text-left p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium text-sm text-blue-600 dark:text-blue-400">
                                {d.name || "Unnamed"}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {d.elevation
                                  ? `${Math.round(d.elevation * 3.28084).toLocaleString()} ft`
                                  : ""}
                                {d.features.length > 0 &&
                                  ` · ${d.features.join(", ")}`}
                              </div>
                            </div>
                            <span className="text-xs text-gray-400 shrink-0 ml-2">
                              {d.distance}m
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* OSM results */}
                <div className="p-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    From OpenStreetMap
                  </h4>
                  {osmResults.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">
                      No named features found nearby
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {osmResults.map((s) => (
                        <button
                          key={s.osm_id}
                          onClick={() => handleSelectOSM(s)}
                          className="w-full text-left p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-green-300 dark:hover:border-green-700 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium text-sm">
                                {s.name}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {s.elevation
                                  ? `${Math.round(s.elevation * 3.28084).toLocaleString()} ft · `
                                  : ""}
                                <span className="text-green-600 dark:text-green-400">
                                  {s.osm_tags}
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-gray-400 shrink-0 ml-2">
                              {s.distance}m
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Create custom */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-800">
                  <button
                    onClick={handleCreateCustom}
                    className="w-full px-4 py-2.5 text-sm border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-600 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    Create at this location
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
