"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminGuard from "../../../../components/admin-guard";
import {
  AdminPage,
  AdminPageHeader,
} from "../../../../components/admin/admin-page";
import { Breadcrumb } from "../../../../components/detail-sections";
import dynamic from "next/dynamic";
import ElevationProfile from "../../../../components/elevation-profile";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input, Label, Select } from "../../../../components/ui/field";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { StatCluster } from "../../../../components/ui/stat";
import { useElevationProfileColors } from "../../../../components/use-elevation-profile-colors";
import { useAuth } from "../../../../lib/auth-context";
import {
  processGPX,
  chopOutAndBack,
  type RouteAnalysis,
  type TrackPoint,
  type NearbyDestination,
} from "../../../../lib/actions/route-builder";
import {
  analyzeRouteSegments,
  saveRouteWithSegments,
  type RouteDecomposition,
  type ProposedSegment,
} from "../../../../lib/actions/segment-matcher";
import {
  reverseGeocodePointName,
  createDestination,
} from "../../../../lib/actions/destinations";
import type { SegmentOverlay } from "../../../../components/route-builder-map";

const RouteBuilderMap = dynamic(() => import("../../../../components/route-builder-map"), {
  ssr: false,
});
const LocationPickerMap = dynamic(() => import("../../../../components/location-picker-map"), {
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
  const { getIdToken } = useAuth();
  const elevationProfileColors = useElevationProfileColors();
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
      if ("duplicate" in result) {
        throw new Error(`Duplicate destination: ${result.duplicate.name ?? result.duplicate.id}`);
      }
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

      const token = await getIdToken();
      if (!token) throw new Error("Not signed in");

      const result = await saveRouteWithSegments(token, {
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
    <AdminPage className="space-y-10">
      <AdminPageHeader
        title="Create route"
        description="Import a GPX track, review its shape and destinations, then reuse or create trail segments."
        breadcrumb={
          <Breadcrumb
            current="Create route"
            parentHref="/admin/routes"
            parentLabel="Routes"
          />
        }
      />

      <div
        className="flex items-center gap-2 overflow-x-auto pb-1 text-sm"
        aria-label="Route creation progress"
      >
        <StepBadge label="1. Upload" active={step === "upload"} done={step !== "upload"} />
        <span className="text-faint" aria-hidden>›</span>
        <StepBadge
          label="2. Review"
          active={step === "review"}
          done={step === "segments" || step === "save"}
        />
        <span className="text-faint" aria-hidden>›</span>
        <StepBadge label="3. Segments" active={step === "segments"} done={step === "save"} />
        <span className="text-faint" aria-hidden>›</span>
        <StepBadge label="4. Save" active={step === "save"} done={false} />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-media border border-alert/30 bg-alert/10 p-4 text-sm text-alert"
        >
          {error}
        </div>
      )}

      {step === "upload" && (
        <UploadStep
          processing={processing}
          onDrop={handleDrop}
          onFileInput={handleFileInput}
        />
      )}

      {step === "review" && stats && (
        <div className="space-y-12">
          <section className="space-y-6" aria-labelledby="route-details-heading">
            <SectionHeading>
              <span id="route-details-heading">Route details</span>
            </SectionHeading>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="route-name">Route name</Label>
                <Input
                  id="route-name"
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Route name…"
                  className="text-base"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setStep("upload");
                  setAnalysis(null);
                  setPoints([]);
                }}
              >
                Upload another file
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-10 gap-y-6">
              <StatCluster
                scale="topline"
                value={(stats.distance / 1609.34).toFixed(1)}
                unit="mi"
                label="One-way distance"
              />
              <StatCluster
                scale="topline"
                value={Math.round(stats.gain * 3.28084).toLocaleString()}
                unit="ft"
                label="Gain"
              />
              <StatCluster
                scale="topline"
                value={Math.round(stats.loss * 3.28084).toLocaleString()}
                unit="ft"
                label="Loss"
              />
              <StatCluster
                scale="topline"
                value={Math.round(stats.minEle * 3.28084).toLocaleString()}
                unit="ft"
                label="Minimum elevation"
              />
              <StatCluster
                scale="topline"
                value={Math.round(stats.maxEle * 3.28084).toLocaleString()}
                unit="ft"
                label="Maximum elevation"
              />
            </div>
          </section>

          <section className="space-y-5" aria-labelledby="route-shape-heading">
            <SectionHeading>
              <span id="route-shape-heading">Shape and tools</span>
            </SectionHeading>
            <div className="grid gap-4 sm:max-w-xl sm:grid-cols-2">
              <div>
                <Label htmlFor="route-shape">Shape</Label>
                <Select
                  id="route-shape"
                  value={shape}
                  onChange={(e) => setShape(e.target.value)}
                >
                  <option value="out_and_back">Out and back</option>
                  <option value="loop">Loop</option>
                  <option value="point_to_point">Point to point</option>
                  <option value="lollipop">Lollipop</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="route-completion">Completion</Label>
                <Select
                  id="route-completion"
                  value={completion}
                  onChange={(e) => setCompletion(e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="straight">Straight</option>
                  <option value="reverse">Reverse</option>
                </Select>
              </div>
            </div>

            {shape === "out_and_back" && turnaroundIndex && !chopped && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button variant="secondary" onClick={handleChop} disabled={processing}>
                  {processing ? "Chopping…" : "Chop at turnaround"}
                </Button>
                <p className="text-xs text-muted">
                  Removes the return portion and keeps the one-way track.
                </p>
              </div>
            )}

            {chopped && (
              <p className="text-sm font-medium text-success">Chopped to one-way.</p>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="route-map-heading">
            <SectionHeading>
              <span id="route-map-heading">Route map</span>
            </SectionHeading>
            <div className="overflow-hidden rounded-media bg-fill">
              <RouteBuilderMap
                points={points}
                destinations={nearbyDests.map((destination) => ({
                  id: destination.id,
                  name: destination.name,
                  lat: destination.lat,
                  lng: destination.lng,
                  selected: selectedDestIds.has(destination.id),
                }))}
                highlightIndex={highlightIndex}
                turnaroundIndex={!chopped ? turnaroundIndex : undefined}
                onDestinationToggle={toggleDest}
              />
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="route-elevation-heading">
            <SectionHeading>
              <span id="route-elevation-heading">Elevation profile</span>
            </SectionHeading>
            <div className="rounded-media bg-surface p-4">
              <ElevationProfile
                points={points}
                colors={elevationProfileColors}
                label={`Elevation profile for ${routeName || "this route"}`}
                highlightIndex={highlightIndex}
                onHover={setHighlightIndex}
              />
            </div>
          </section>

          {showTrailheadPrompt && !trailheadDismissed && !trailheadCreated && (
            <section className="space-y-5" aria-labelledby="trailhead-prompt-heading">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <SectionHeading>
                    <span id="trailhead-prompt-heading">No starting destination found</span>
                  </SectionHeading>
                  <p className="mt-1 max-w-[68ch] text-sm text-muted">
                    There is no destination near the start of this route. Add one now if the track begins at a trailhead or landmark.
                  </p>
                </div>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setTrailheadDismissed(true)}
                >
                  Dismiss
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
                <div>
                  <Label htmlFor="trailhead-name">Name</Label>
                  <Input
                    id="trailhead-name"
                    type="text"
                    value={trailheadName}
                    onChange={(e) => setTrailheadName(e.target.value)}
                    placeholder={trailheadName ? undefined : "Loading suggestion…"}
                  />
                </div>
                <div>
                  <Label htmlFor="trailhead-feature">Type</Label>
                  <Select
                    id="trailhead-feature"
                    value={trailheadFeature}
                    onChange={(e) => setTrailheadFeature(e.target.value)}
                  >
                    <option value="trailhead">Trailhead</option>
                    <option value="summit">Summit</option>
                    <option value="hut">Hut</option>
                    <option value="lookout">Lookout</option>
                    <option value="lake">Lake</option>
                    <option value="landform">Landform</option>
                    <option value="viewpoint">Viewpoint</option>
                    <option value="waterfall">Waterfall</option>
                    <option value="campsite">Campsite</option>
                  </Select>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleCreateTrailhead}
                  disabled={trailheadLoading || !trailheadName.trim()}
                >
                  {trailheadLoading ? "Creating…" : "Create destination"}
                </Button>
              </div>

              <p className="font-mono-num text-xs tabular-nums text-muted">
                Drag the marker to adjust the location. Current: {trailheadLat.toFixed(5)}, {trailheadLng.toFixed(5)}
                {points[0]?.ele != null
                  ? ` (${Math.round(points[0].ele * 3.28084).toLocaleString()} ft)`
                  : ""}
              </p>
              <div className="overflow-hidden rounded-media bg-fill">
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
            </section>
          )}

          {trailheadCreated && (
            <p className="text-sm font-medium text-success">
              Created &ldquo;{trailheadName}&rdquo; and added it to this route.
            </p>
          )}

          <section className="space-y-5" aria-labelledby="route-destinations-heading">
            <div>
              <SectionHeading>
                <span id="route-destinations-heading">Destinations along route</span>
              </SectionHeading>
              <p className="mt-1 text-sm text-muted">
                {nearbyDests.length} found within 1.5 km of the track.
              </p>
            </div>
            {nearbyDests.length === 0 ? (
              <EmptyState
                title="No nearby destinations"
                description="No destinations were found within 1.5 km of this route."
              />
            ) : (
              <div className="overflow-hidden rounded-media border border-border bg-page">
                {nearbyDests.map((destination, index) => (
                  <label
                    key={destination.id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
                      index > 0 ? "border-t border-hairline" : ""
                    } ${selectedDestIds.has(destination.id) ? "bg-fill" : "hover:bg-surface"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDestIds.has(destination.id)}
                      onChange={() => toggleDest(destination.id)}
                      className="rounded-ctl accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">
                        {destination.name || "Unnamed"}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        {destination.elevation && (
                          <span className="font-mono-num tabular-nums">
                            {Math.round(destination.elevation * 3.28084).toLocaleString()} ft
                          </span>
                        )}
                        <span className="font-mono-num tabular-nums">
                          {destination.distanceFromRoute} m from route
                        </span>
                        {destination.features.length > 0 && (
                          <span>{destination.features.join(", ")}</span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </section>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setStep("upload");
                setAnalysis(null);
                setPoints([]);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAnalyzeSegments}
              disabled={analyzing || !routeName.trim()}
            >
              {analyzing ? "Analyzing segments…" : "Analyze segments"}
            </Button>
          </div>
        </div>
      )}

      {step === "segments" && decomposition && stats && (
        <div className="space-y-12">
          <section className="space-y-6" aria-labelledby="segment-analysis-heading">
            <SectionHeading>
              <span id="segment-analysis-heading">
                Segment analysis for &ldquo;{routeName}&rdquo;
              </span>
            </SectionHeading>
            <div className="flex flex-wrap gap-x-10 gap-y-6">
              <StatCluster
                value={decomposition.segments.length.toLocaleString()}
                label="Segments"
                scale="card"
              />
              <StatCluster
                value={decomposition.segments.filter((segment) => segment.type === "existing").length.toLocaleString()}
                label="Existing reused"
                scale="card"
              />
              <StatCluster
                value={decomposition.segments.filter((segment) => segment.type === "split").length.toLocaleString()}
                label="Partial matches"
                scale="card"
              />
              <StatCluster
                value={decomposition.segments.filter((segment) => segment.type === "new").length.toLocaleString()}
                label="New segments"
                scale="card"
              />
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="segment-map-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeading>
                <span id="segment-map-heading">Segment map</span>
              </SectionHeading>
              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2" aria-label="Segment types">
                <SegmentLegendItem type="new" label="New" />
                <SegmentLegendItem type="existing" label="Existing" />
                <SegmentLegendItem type="split" label="Partial match" />
              </div>
            </div>
            <div className="overflow-hidden rounded-media bg-fill">
              <RouteBuilderMap
                points={points}
                destinations={nearbyDests.map((destination) => ({
                  id: destination.id,
                  name: destination.name,
                  lat: destination.lat,
                  lng: destination.lng,
                  selected: selectedDestIds.has(destination.id),
                }))}
                segments={segmentOverlays}
                onDestinationToggle={toggleDest}
              />
            </div>
          </section>

          <section className="space-y-5" aria-labelledby="proposed-segments-heading">
            <SectionHeading>
              <span id="proposed-segments-heading">Proposed segments</span>
            </SectionHeading>
            <div className="overflow-hidden rounded-media border border-border bg-page">
              {decomposition.segments.map((segment, index) => (
                <div
                  key={index}
                  className={`p-4 sm:p-5 ${index > 0 ? "border-t border-hairline" : ""}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="shrink-0 sm:pt-2">
                      <SegmentTypeBadge type={segment.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Input
                        type="text"
                        aria-label={`Name for segment ${index + 1}`}
                        value={segmentNames.get(index) || ""}
                        onChange={(e) => updateSegmentName(index, e.target.value)}
                        placeholder={
                          segment.type === "existing"
                            ? segment.existingSegmentName || "Segment name…"
                            : "Name this segment…"
                        }
                      />
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono-num text-xs tabular-nums text-muted">
                        <span>{(segment.distance / 1609.34).toFixed(1)} mi</span>
                        <span>{Math.round(segment.gain * 3.28084).toLocaleString()} ft gain</span>
                        <span>{Math.round(segment.loss * 3.28084).toLocaleString()} ft loss</span>
                        <span>{segment.points.length.toLocaleString()} points</span>
                        {segment.type === "existing" && segment.direction === "reverse" && (
                          <span className="text-alert">Reversed</span>
                        )}
                        {segment.type === "split" && (
                          <span className="text-alert">
                            {Math.round((segment.startFraction || 0) * 100)}%–
                            {Math.round((segment.endFraction || 1) * 100)}% of parent
                          </span>
                        )}
                      </div>
                      {segment.type === "existing" && (
                        <p className="mt-1 text-xs text-muted">
                          Reuses existing segment: {segment.existingSegmentName || segment.existingSegmentId}
                        </p>
                      )}
                      {segment.type === "split" && (
                        <p className="mt-1 text-xs text-alert">
                          Partial match with: {segment.existingSegmentName || segment.parentSegmentId}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {(decomposition.splits.length > 0 || decomposition.affectedRoutes.length > 0) && (
            <section className="space-y-6" aria-labelledby="impact-analysis-heading">
              <SectionHeading>
                <span id="impact-analysis-heading">Impact analysis</span>
              </SectionHeading>

              {decomposition.splits.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-ink-2">
                    Segments to split ({decomposition.splits.length})
                  </h3>
                  <div className="overflow-hidden rounded-media border border-border bg-page">
                    {decomposition.splits.map((split, index) => (
                      <div
                        key={index}
                        className={`px-4 py-3 text-sm ${index > 0 ? "border-t border-hairline" : ""}`}
                      >
                        <span className="font-medium text-ink">
                          {split.originalSegmentName || split.originalSegmentId}
                        </span>
                        <span className="ml-2 text-muted">
                          will be split at{" "}
                          <span className="font-mono-num tabular-nums">
                            {split.fractions
                              .map((fraction) => `${Math.round(fraction * 100)}%`)
                              .join(", ")}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {decomposition.affectedRoutes.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-ink-2">
                    Affected routes ({new Set(decomposition.affectedRoutes.map((route) => route.routeId)).size})
                  </h3>
                  <div className="overflow-hidden rounded-media border border-border bg-page">
                    {Array.from(
                      new Map(
                        decomposition.affectedRoutes.map((route) => [route.routeId, route])
                      ).values()
                    ).map((route, index) => (
                      <div
                        key={route.routeId}
                        className={`px-4 py-3 text-sm ${index > 0 ? "border-t border-hairline" : ""}`}
                      >
                        <Link
                          href={`/admin/routes/${route.routeId}`}
                          className="font-medium text-accent-text hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {route.routeName || route.routeId}
                        </Link>
                        <span className="ml-2 text-muted">
                          — segment references will update automatically
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="space-y-3" aria-labelledby="segment-elevation-heading">
            <SectionHeading>
              <span id="segment-elevation-heading">Elevation profile</span>
            </SectionHeading>
            <div className="rounded-media bg-surface p-4">
              <ElevationProfile
                points={points}
                colors={elevationProfileColors}
                label={`Elevation profile for ${routeName || "this route"}`}
                highlightIndex={highlightIndex}
                onHover={setHighlightIndex}
              />
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="secondary" onClick={() => setStep("review")}>
              Back to review
            </Button>
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <Button
                variant="secondary"
                onClick={handleAnalyzeSegments}
                disabled={analyzing}
              >
                {analyzing ? "Re-analyzing…" : "Re-analyze"}
              </Button>
              <Button onClick={handleSave} disabled={saving || !routeName.trim()}>
                {saving ? "Creating route…" : "Create route"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

function StepBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const stateClass = active
    ? "border-accent bg-fill text-accent-text"
    : done
      ? "border-success/30 text-success"
      : "";
  return <Badge className={`shrink-0 ${stateClass}`}>{label}</Badge>;
}

function SegmentTypeBadge({ type }: { type: "existing" | "new" | "split" }) {
  const labels = {
    existing: "Existing",
    split: "Partial",
    new: "New",
  } as const;
  const stateClass =
    type === "new"
      ? "border-accent/40 text-accent-text"
      : type === "split"
        ? "border-alert/30 text-alert"
        : "";
  return <Badge className={stateClass}>{labels[type]}</Badge>;
}

function SegmentLegendItem({
  type,
  label,
}: {
  type: "existing" | "new" | "split";
  label: string;
}) {
  const lineClass = {
    new: "h-1 rounded-full bg-accent",
    existing: "h-1 rounded-full bg-ink-2",
    split: "h-0 border-t-2 border-dashed border-alert",
  }[type];
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-4 ${lineClass}`} aria-hidden />
      {label}
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

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose a GPX file"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        onDrop(e);
      }}
      onClick={openFilePicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFilePicker();
        }
      }}
      className={`cursor-pointer rounded-media border border-dashed px-6 py-8 transition-colors sm:px-12 sm:py-12 ${
        dragging
          ? "border-accent bg-fill"
          : "border-border bg-surface hover:border-ink-2"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        onChange={onFileInput}
        className="hidden"
      />
      <EmptyState
        className="py-4"
        title={processing ? "Processing GPX…" : "Drop a GPX file here"}
        description={
          processing
            ? "Parsing the track, fetching elevation, and matching destinations."
            : "Or choose a file. Peaks will fetch elevation from Mapbox Terrain-RGB."
        }
      />
    </div>
  );
}
