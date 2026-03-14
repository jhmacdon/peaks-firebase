"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";
import dynamic from "next/dynamic";
import ElevationProfile from "@/components/elevation-profile";
import {
  processGPX,
  chopOutAndBack,
  type RouteAnalysis,
  type TrackPoint,
  type NearbyDestination,
} from "@/lib/actions/route-builder";
import {
  analyzeRouteSegments,
  saveRouteWithSegments,
  type RouteDecomposition,
  type ProposedSegment,
} from "@/lib/actions/segment-matcher";
import {
  reverseGeocodePointName,
  createDestination,
} from "@/lib/actions/destinations";
import type { SegmentOverlay } from "@/components/route-builder-map";

const RouteBuilderMap = dynamic(() => import("@/components/route-builder-map"), {
  ssr: false,
});
const LocationPickerMap = dynamic(() => import("@/components/location-picker-map"), {
  ssr: false,
});

export default function NewRoutePage() {
  return (
    <AdminGuard>
      <NewRouteContent />
    </AdminGuard>
  );
}

type Step = "upload" | "review" | "segments" | "save";

function NewRouteContent() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Route data
  const [, setAnalysis] = useState<RouteAnalysis | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [stats, setStats] = useState<RouteAnalysis["stats"] | null>(null);
  const [shape, setShape] = useState<string>("point_to_point");
  const [turnaroundIndex, setTurnaroundIndex] = useState<number | undefined>();
  const [nearbyDests, setNearbyDests] = useState<NearbyDestination[]>([]);
  const [selectedDestIds, setSelectedDestIds] = useState<Set<string>>(new Set());
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [chopped, setChopped] = useState(false);

  // Save form
  const [routeName, setRouteName] = useState("");
  const [completion, setCompletion] = useState("none");
  const [saving, setSaving] = useState(false);

  // Segment analysis
  const [decomposition, setDecomposition] = useState<RouteDecomposition | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [segmentNames, setSegmentNames] = useState<Map<number, string>>(new Map());

  // Trailhead creation prompt
  const [showTrailheadPrompt, setShowTrailheadPrompt] = useState(false);
  const [trailheadName, setTrailheadName] = useState("");
  const [trailheadFeature, setTrailheadFeature] = useState("trailhead");
  const [trailheadLat, setTrailheadLat] = useState(0);
  const [trailheadLng, setTrailheadLng] = useState(0);
  const [trailheadLoading, setTrailheadLoading] = useState(false);
  const [trailheadDismissed, setTrailheadDismissed] = useState(false);
  const [trailheadCreated, setTrailheadCreated] = useState(false);

  // GPX upload
  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setProcessing(true);

    try {
      const text = await file.text();
      const result = await processGPX(text);

      setAnalysis(result);
      setPoints(result.points);
      setStats(result.stats);
      setShape(result.shape);
      setTurnaroundIndex(result.turnaroundIndex);
      setNearbyDests(result.nearbyDestinations);
      setRouteName(result.name || file.name.replace(/\.gpx$/i, ""));
      setChopped(false);
      setDecomposition(null);
      setSegmentNames(new Map());

      // Auto-select destinations within 200m of route
      const autoSelected = new Set(
        result.nearbyDestinations
          .filter((d) => d.distanceFromRoute < 200)
          .map((d) => d.id)
      );
      setSelectedDestIds(autoSelected);

      // Check if there's a destination near the start of the route
      const startDests = result.nearbyDestinations.filter(
        (d) => d.nearestPointIndex < Math.min(10, result.points.length * 0.05)
          && d.distanceFromRoute < 300
      );
      setTrailheadDismissed(false);
      setTrailheadCreated(false);
      if (startDests.length === 0 && result.points.length > 0) {
        setShowTrailheadPrompt(true);
        setTrailheadName("");
        setTrailheadFeature("trailhead");
        setTrailheadLat(result.points[0].lat);
        setTrailheadLng(result.points[0].lng);
        // Kick off reverse geocode for name suggestion (fire-and-forget)
        const startPt = result.points[0];
        reverseGeocodePointName(startPt.lat, startPt.lng)
          .then((geo) => {
            if (geo.suggestedName) {
              setTrailheadName((prev) => prev || geo.suggestedName || "");
            }
          })
          .catch(() => {});
      } else {
        setShowTrailheadPrompt(false);
      }

      setStep("review");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process GPX file");
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith(".gpx")) {
        handleFile(file);
      } else {
        setError("Please drop a .gpx file");
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChop = async () => {
    if (!turnaroundIndex || !points.length) return;
    setProcessing(true);
    try {
      const result = await chopOutAndBack(points, turnaroundIndex);
      setPoints(result.points);
      setStats(result.stats);
      setChopped(true);
      setDecomposition(null);
      setNearbyDests((prev) =>
        prev.filter((d) => d.nearestPointIndex <= turnaroundIndex)
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to chop route");
    } finally {
      setProcessing(false);
    }
  };

  const toggleDest = (id: string) => {
    setSelectedDestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateTrailhead = async () => {
    if (!trailheadName.trim() || !points.length) return;
    setTrailheadLoading(true);
    try {
      const ele = points[0].ele;
      const result = await createDestination({
        name: trailheadName.trim(),
        lat: trailheadLat,
        lng: trailheadLng,
        elevation: ele,
        features: [trailheadFeature],
      });
      // Add the new destination to the nearby list and auto-select it
      setNearbyDests((prev) => [
        {
          id: result.id,
          name: trailheadName.trim(),
          elevation: ele,
          features: [trailheadFeature],
          lat: trailheadLat,
          lng: trailheadLng,
          distanceFromRoute: 0,
          nearestPointIndex: 0,
        },
        ...prev,
      ]);
      setSelectedDestIds((prev) => new Set([...prev, result.id]));
      setTrailheadCreated(true);
      setShowTrailheadPrompt(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create destination");
    } finally {
      setTrailheadLoading(false);
    }
  };

  const handleAnalyzeSegments = async () => {
    if (!points.length) return;
    setAnalyzing(true);
    setError(null);

    try {
      const result = await analyzeRouteSegments(points);
      setDecomposition(result);

      // Initialize segment names from the decomposition
      const names = new Map<number, string>();
      result.segments.forEach((seg, i) => {
        names.set(i, seg.name || "");
      });
      setSegmentNames(names);

      setStep("segments");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to analyze segments");
    } finally {
      setAnalyzing(false);
    }
  };

  const updateSegmentName = (idx: number, name: string) => {
    setSegmentNames((prev) => {
      const next = new Map(prev);
      next.set(idx, name);
      return next;
    });
  };

  const handleSave = async () => {
    if (!points.length || !routeName.trim() || !decomposition) return;
    setSaving(true);
    setError(null);

    try {
      // Apply user-edited segment names to the decomposition
      const updatedSegments: ProposedSegment[] = decomposition.segments.map((seg, i) => ({
        ...seg,
        name: segmentNames.get(i)?.trim() || seg.name,
      }));

      const result = await saveRouteWithSegments({
        name: routeName.trim(),
        shape,
        completion,
        decomposition: { ...decomposition, segments: updatedSegments },
        destinationIds: nearbyDests
          .filter((d) => selectedDestIds.has(d.id))
          .sort((a, b) => a.nearestPointIndex - b.nearestPointIndex)
          .map((d) => d.id),
      });

      router.push(`/admin/routes/${result.routeId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save route");
      setSaving(false);
    }
  };

  // Build segment overlays for the map
  const segmentOverlays: SegmentOverlay[] | undefined =
    decomposition?.segments.map((seg, i) => ({
      type: seg.type,
      points: seg.points,
      name: segmentNames.get(i) || seg.name,
    }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link
            href="/admin/routes"
            className="hover:text-gray-900 dark:hover:text-gray-100"
          >
            Routes
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">New Route</span>
        </div>

        <h2 className="text-2xl font-semibold mb-6">Create Route</h2>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 text-sm">
          <StepBadge label="1. Upload" active={step === "upload"} done={step !== "upload"} />
          <span className="text-gray-300">&rarr;</span>
          <StepBadge label="2. Review" active={step === "review"} done={step === "segments" || step === "save"} />
          <span className="text-gray-300">&rarr;</span>
          <StepBadge label="3. Segments" active={step === "segments"} done={step === "save"} />
          <span className="text-gray-300">&rarr;</span>
          <StepBadge label="4. Save" active={step === "save"} done={false} />
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === "upload" && (
          <UploadStep
            processing={processing}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
          />
        )}

        {/* Step 2: Review */}
        {step === "review" && stats && (
          <div className="space-y-6">
            {/* Route Name */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-center gap-4 mb-4">
                <input
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Route name..."
                  className="text-2xl font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none pb-1 flex-1"
                />
                <button
                  onClick={() => {
                    setStep("upload");
                    setAnalysis(null);
                    setPoints([]);
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Upload Different
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <MiniStat
                  label="Distance (one-way)"
                  value={`${(stats.distance / 1609.34).toFixed(1)} mi`}
                />
                <MiniStat
                  label="Gain"
                  value={`${Math.round(stats.gain * 3.28084).toLocaleString()} ft`}
                />
                <MiniStat
                  label="Loss"
                  value={`${Math.round(stats.loss * 3.28084).toLocaleString()} ft`}
                />
                <MiniStat
                  label="Min Elevation"
                  value={`${Math.round(stats.minEle * 3.28084).toLocaleString()} ft`}
                />
                <MiniStat
                  label="Max Elevation"
                  value={`${Math.round(stats.maxEle * 3.28084).toLocaleString()} ft`}
                />
              </div>
            </div>

            {/* Shape & Tools */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-4">Route Shape & Tools</h3>
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="text-sm text-gray-500 block mb-1">Shape</label>
                  <select
                    value={shape}
                    onChange={(e) => setShape(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                  >
                    <option value="out_and_back">Out & Back</option>
                    <option value="loop">Loop</option>
                    <option value="point_to_point">Point to Point</option>
                    <option value="lollipop">Lollipop</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500 block mb-1">Completion</label>
                  <select
                    value={completion}
                    onChange={(e) => setCompletion(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                  >
                    <option value="none">None</option>
                    <option value="straight">Straight</option>
                    <option value="reverse">Reverse</option>
                  </select>
                </div>

                {shape === "out_and_back" && turnaroundIndex && !chopped && (
                  <div className="ml-auto">
                    <button
                      onClick={handleChop}
                      disabled={processing}
                      className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      {processing ? "Chopping..." : "Chop at Turnaround"}
                    </button>
                    <p className="text-xs text-gray-500 mt-1">
                      Removes the return portion, keeping one-way only
                    </p>
                  </div>
                )}

                {chopped && (
                  <span className="text-sm text-green-600 dark:text-green-400 ml-auto">
                    Chopped to one-way
                  </span>
                )}
              </div>
            </div>

            {/* Map */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-3">Route Map</h3>
              <RouteBuilderMap
                points={points}
                destinations={nearbyDests.map((d) => ({
                  id: d.id,
                  name: d.name,
                  lat: d.lat,
                  lng: d.lng,
                  selected: selectedDestIds.has(d.id),
                }))}
                highlightIndex={highlightIndex}
                turnaroundIndex={!chopped ? turnaroundIndex : undefined}
                onDestinationToggle={toggleDest}
              />
            </div>

            {/* Elevation Profile */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-3">Elevation Profile</h3>
              <ElevationProfile
                points={points}
                highlightIndex={highlightIndex}
                onHover={setHighlightIndex}
              />
            </div>

            {/* Trailhead Prompt */}
            {showTrailheadPrompt && !trailheadDismissed && !trailheadCreated && (
              <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-amber-900 dark:text-amber-200">
                      No starting destination found
                    </h3>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                      There&apos;s no destination near the start of this route. Would you like to create one?
                    </p>
                  </div>
                  <button
                    onClick={() => setTrailheadDismissed(true)}
                    className="text-amber-400 hover:text-amber-600 dark:text-amber-600 dark:hover:text-amber-400 text-lg leading-none"
                    title="Dismiss"
                  >
                    &times;
                  </button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs text-amber-700 dark:text-amber-400 block mb-1">Name</label>
                    <input
                      type="text"
                      value={trailheadName}
                      onChange={(e) => setTrailheadName(e.target.value)}
                      placeholder={trailheadName ? undefined : "Loading suggestion..."}
                      className="w-full px-3 py-2 text-sm border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700 dark:text-amber-400 block mb-1">Type</label>
                    <select
                      value={trailheadFeature}
                      onChange={(e) => setTrailheadFeature(e.target.value)}
                      className="px-3 py-2 text-sm border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-900"
                    >
                      <option value="trailhead">Trailhead</option>
                      <option value="summit">Summit</option>
                      <option value="hut">Hut</option>
                      <option value="lookout">Lookout</option>
                    </select>
                  </div>
                  <button
                    onClick={handleCreateTrailhead}
                    disabled={trailheadLoading || !trailheadName.trim()}
                    className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {trailheadLoading ? "Creating..." : "Create Destination"}
                  </button>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-amber-600 dark:text-amber-500 mb-2">
                    Drag the marker to adjust the location.
                    Current: {trailheadLat.toFixed(5)}, {trailheadLng.toFixed(5)}
                    {points[0]?.ele ? ` (${Math.round(points[0].ele * 3.28084).toLocaleString()} ft)` : ""}
                  </p>
                  <LocationPickerMap
                    lat={trailheadLat}
                    lng={trailheadLng}
                    routePoints={points.slice(0, Math.min(50, points.length))}
                    onChange={(lat, lng) => {
                      setTrailheadLat(lat);
                      setTrailheadLng(lng);
                    }}
                  />
                </div>
              </div>
            )}

            {trailheadCreated && (
              <div className="bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-800 p-4 text-sm text-green-700 dark:text-green-300">
                Created &ldquo;{trailheadName}&rdquo; and added it to this route.
              </div>
            )}

            {/* Destinations */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-4">
                Destinations Along Route ({nearbyDests.length} found)
              </h3>
              {nearbyDests.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No destinations found within 1.5km of route
                </p>
              ) : (
                <div className="space-y-2">
                  {nearbyDests.map((dest) => (
                    <label
                      key={dest.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                        selectedDestIds.has(dest.id)
                          ? "border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30"
                          : "border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDestIds.has(dest.id)}
                        onChange={() => toggleDest(dest.id)}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {dest.name || "Unnamed"}
                        </div>
                        <div className="text-xs text-gray-500 flex gap-2">
                          {dest.elevation && (
                            <span>
                              {Math.round(dest.elevation * 3.28084).toLocaleString()} ft
                            </span>
                          )}
                          <span>{dest.distanceFromRoute}m from route</span>
                          {dest.features.length > 0 && (
                            <span>{dest.features.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setStep("upload");
                  setAnalysis(null);
                  setPoints([]);
                }}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAnalyzeSegments}
                disabled={analyzing || !routeName.trim()}
                className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {analyzing ? "Analyzing Segments..." : "Analyze Segments"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Segment Analysis */}
        {step === "segments" && decomposition && stats && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Segment Analysis for &ldquo;{routeName}&rdquo;</h3>
              <div className="flex gap-4 text-sm text-gray-500">
                <span>{decomposition.segments.length} segment{decomposition.segments.length !== 1 ? "s" : ""}</span>
                <span>{decomposition.segments.filter((s) => s.type === "existing").length} existing reused</span>
                <span>{decomposition.segments.filter((s) => s.type === "split").length} partial matches</span>
                <span>{decomposition.segments.filter((s) => s.type === "new").length} new</span>
              </div>
            </div>

            {/* Map with color-coded segments */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Segment Map</h3>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-blue-600 inline-block" /> New
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-purple-600 inline-block" /> Existing
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-1 rounded bg-amber-500 inline-block" /> Partial Match
                  </span>
                </div>
              </div>
              <RouteBuilderMap
                points={points}
                destinations={nearbyDests.map((d) => ({
                  id: d.id,
                  name: d.name,
                  lat: d.lat,
                  lng: d.lng,
                  selected: selectedDestIds.has(d.id),
                }))}
                segments={segmentOverlays}
                onDestinationToggle={toggleDest}
              />
            </div>

            {/* Segment List */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-4">Proposed Segments</h3>
              <div className="space-y-3">
                {decomposition.segments.map((seg, i) => (
                  <div
                    key={i}
                    className={`p-4 rounded-lg border ${
                      seg.type === "existing"
                        ? "border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20"
                        : seg.type === "split"
                        ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                        : "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        <SegmentTypeBadge type={seg.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={segmentNames.get(i) || ""}
                          onChange={(e) => updateSegmentName(i, e.target.value)}
                          placeholder={
                            seg.type === "existing"
                              ? seg.existingSegmentName || "Segment name..."
                              : "Name this segment..."
                          }
                          className="w-full font-medium text-sm bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:outline-none pb-0.5"
                        />
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                          <span>{(seg.distance / 1609.34).toFixed(1)} mi</span>
                          <span>{Math.round(seg.gain * 3.28084).toLocaleString()} ft gain</span>
                          <span>{Math.round(seg.loss * 3.28084).toLocaleString()} ft loss</span>
                          <span>{seg.points.length} points</span>
                          {seg.type === "existing" && seg.direction === "reverse" && (
                            <span className="text-amber-600">Reversed</span>
                          )}
                          {seg.type === "split" && (
                            <span className="text-amber-600">
                              {Math.round((seg.startFraction || 0) * 100)}%&ndash;{Math.round((seg.endFraction || 1) * 100)}% of parent
                            </span>
                          )}
                        </div>
                        {seg.type === "existing" && (
                          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                            Reuses existing segment: {seg.existingSegmentName || seg.existingSegmentId}
                          </p>
                        )}
                        {seg.type === "split" && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Partial match with: {seg.existingSegmentName || seg.parentSegmentId}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Splits & Affected Routes */}
            {(decomposition.splits.length > 0 || decomposition.affectedRoutes.length > 0) && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                <h3 className="font-semibold mb-4">Impact Analysis</h3>

                {decomposition.splits.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Segments to Split ({decomposition.splits.length})
                    </h4>
                    <div className="space-y-2">
                      {decomposition.splits.map((split, i) => (
                        <div key={i} className="text-sm p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                          <span className="font-medium">{split.originalSegmentName || split.originalSegmentId}</span>
                          <span className="text-gray-500 ml-2">
                            will be split at {split.fractions.map((f) => `${Math.round(f * 100)}%`).join(", ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {decomposition.affectedRoutes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Affected Routes ({new Set(decomposition.affectedRoutes.map((r) => r.routeId)).size})
                    </h4>
                    <div className="space-y-2">
                      {Array.from(
                        new Map(
                          decomposition.affectedRoutes.map((r) => [r.routeId, r])
                        ).values()
                      ).map((route) => (
                        <div key={route.routeId} className="text-sm p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <Link
                            href={`/admin/routes/${route.routeId}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                            target="_blank"
                          >
                            {route.routeName || route.routeId}
                          </Link>
                          <span className="text-gray-500 ml-2">
                            &mdash; segment references will be updated automatically
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Elevation Profile */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-3">Elevation Profile</h3>
              <ElevationProfile
                points={points}
                highlightIndex={highlightIndex}
                onHover={setHighlightIndex}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              <button
                onClick={() => setStep("review")}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Back to Review
              </button>
              <div className="flex gap-3">
                <button
                  onClick={handleAnalyzeSegments}
                  disabled={analyzing}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {analyzing ? "Re-analyzing..." : "Re-analyze"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !routeName.trim()}
                  className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Creating Route..." : "Create Route"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StepBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
        active
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : done
          ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
      }`}
    >
      {label}
    </span>
  );
}

function SegmentTypeBadge({ type }: { type: "existing" | "new" | "split" }) {
  const config = {
    existing: { label: "Existing", bg: "bg-purple-100 dark:bg-purple-900", text: "text-purple-700 dark:text-purple-300" },
    split: { label: "Partial", bg: "bg-amber-100 dark:bg-amber-900", text: "text-amber-700 dark:text-amber-300" },
    new: { label: "New", bg: "bg-blue-100 dark:bg-blue-900", text: "text-blue-700 dark:text-blue-300" },
  };
  const c = config[type];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function UploadStep({
  processing,
  onDrop,
  onFileInput,
}: {
  processing: boolean;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        onDrop(e);
      }}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
          : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        onChange={onFileInput}
        className="hidden"
      />

      {processing ? (
        <div>
          <div className="text-lg font-medium mb-2">Processing GPX...</div>
          <p className="text-sm text-gray-500">
            Parsing track, fetching elevation data, matching destinations...
          </p>
        </div>
      ) : (
        <div>
          <div className="text-4xl mb-4 text-gray-400">+</div>
          <div className="text-lg font-medium mb-2">
            Drop a GPX file here
          </div>
          <p className="text-sm text-gray-500">
            or click to browse. Elevation data will be fetched from Mapbox
            Terrain-RGB.
          </p>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
