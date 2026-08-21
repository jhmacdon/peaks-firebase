"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AdminGuard from "../../../../components/admin-guard";
import {
  AdminPage,
  AdminPageHeader,
} from "../../../../components/admin/admin-page";
import { Button } from "../../../../components/ui/button";
import { Input, Label, Select } from "../../../../components/ui/field";
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
  osmId?: string;
}

interface Toast {
  id: string;
  name: string;
  destId: string;
  kind: "created" | "duplicate";
}

const ALL_FEATURES = [
  "summit",
  "trailhead",
  "volcano",
  "fire-lookout",
  "hut",
  "lookout",
  "lake",
  "landform",
  "viewpoint",
  "waterfall",
  "campsite",
] as const;

const TOAST_DURATION = 8000;

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[1100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2 sm:bottom-6"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-ctl border border-border bg-page px-4 py-3 shadow-float"
        >
          <span
            className={`shrink-0 text-sm font-medium ${
              toast.kind === "duplicate" ? "text-alert" : "text-success"
            }`}
          >
            {toast.kind === "duplicate" ? "Exists" : "Created"}
          </span>
          <Link
            href={`/admin/destinations/${toast.destId}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-accent-text hover:underline"
          >
            {toast.name}
          </Link>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label={`Dismiss ${toast.name} notice`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-lg leading-none text-faint transition-colors hover:bg-fill hover:text-ink-2"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

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
  const searchRequestId = useRef(0);

  // Map / search state
  const [clickedPoint, setClickedPoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [osmSearchFailed, setOsmSearchFailed] = useState(false);
  const [existing, setExisting] = useState<NearbyDestination[]>([]);
  const [osmResults, setOsmResults] = useState<OSMSuggestion[]>([]);
  const [latitudeInput, setLatitudeInput] = useState("");
  const [longitudeInput, setLongitudeInput] = useState("");
  const [coordinateError, setCoordinateError] = useState("");

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
  }, [toasts.length]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      const requestId = ++searchRequestId.current;
      setClickedPoint({ lat, lng });
      setLatitudeInput(lat.toFixed(5));
      setLongitudeInput(lng.toFixed(5));
      setCoordinateError("");
      setSearching(true);
      setSearchError("");
      setOsmSearchFailed(false);
      setExisting([]);
      setOsmResults([]);

      try {
        const [databaseResult, osmResult] = await Promise.allSettled([
          searchNearbyExisting(lat, lng),
          searchOSMNearby(lat, lng),
        ]);

        if (requestId !== searchRequestId.current) return;

        const databaseFailed = databaseResult.status === "rejected";
        const openStreetMapFailed = osmResult.status === "rejected";

        setExisting(databaseFailed ? [] : databaseResult.value);
        setOsmResults(openStreetMapFailed ? [] : osmResult.value);
        setOsmSearchFailed(openStreetMapFailed);

        if (databaseFailed && openStreetMapFailed) {
          setSearchError("Nearby results could not be loaded. Try the search again.");
        } else if (databaseFailed || openStreetMapFailed) {
          setSearchError("One nearby source could not be loaded. The results may be incomplete.");
        }
      } catch {
        if (requestId === searchRequestId.current) {
          setExisting([]);
          setOsmResults([]);
          setOsmSearchFailed(true);
          setSearchError("Nearby results could not be loaded. Try the search again.");
        }
      } finally {
        if (requestId === searchRequestId.current) {
          setSearching(false);
        }
      }
    },
    []
  );

  const handleCoordinateSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const latitude = Number(latitudeInput);
    const longitude = Number(longitudeInput);
    const validLatitude =
      latitudeInput.trim() !== "" &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90;
    const validLongitude =
      longitudeInput.trim() !== "" &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180;

    if (!validLatitude || !validLongitude) {
      setCoordinateError(
        "Enter a latitude from -90 to 90 and a longitude from -180 to 180."
      );
      return;
    }

    void handleMapClick(latitude, longitude);
  };

  const handleSelectOSM = (s: OSMSuggestion) => {
    setConfirm({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      elevation: s.elevation,
      features: s.feature ? [s.feature] : [],
      type: "point",
      source: `OSM (${s.osm_tags})`,
      osmId: String(s.osm_id),
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
    const requestLatitude = confirm.lat;
    const requestLongitude = confirm.lng;
    setLookingUpElevation(true);
    try {
      const ele = await lookupElevation(requestLatitude, requestLongitude);
      if (ele != null) {
        setConfirm((current) => {
          if (
            !current ||
            current.lat !== requestLatitude ||
            current.lng !== requestLongitude
          ) {
            return current;
          }
          return { ...current, elevation: ele };
        });
      }
    } catch {
      // silent
    } finally {
      setLookingUpElevation(false);
    }
  };

  const handleSave = async () => {
    if (!confirm || !confirm.name.trim() || saving) return;
    setSaving(true);
    try {
      const result = await createDestination({
        name: confirm.name.trim(),
        lat: confirm.lat,
        lng: confirm.lng,
        elevation: confirm.elevation,
        features: confirm.features,
        type: confirm.type,
        external_ids: confirm.osmId ? { osm: confirm.osmId } : undefined,
      });
      if ("duplicate" in result) {
        setToasts((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: result.duplicate.name ?? "(unnamed)",
            destId: result.duplicate.id,
            kind: "duplicate",
          },
        ]);
        return;
      }
      if (boundary) {
        await updateDestinationBoundary(result.id, boundary);
      }
      const name = confirm.name.trim();
      setToasts((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name,
          destId: result.id,
          kind: "created",
        },
      ]);
      searchRequestId.current += 1;
      setConfirm(null);
      setBoundary(null);
      setShowBoundaryEditor(false);
      setClickedPoint(null);
      setSearching(false);
      setSearchError("");
      setOsmSearchFailed(false);
      setExisting([]);
      setOsmResults([]);
      setLatitudeInput("");
      setLongitudeInput("");
      setCoordinateError("");
      setStep("pick");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create destination");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  const mapMarkers = [
    ...existing.map((d) => ({
      lat: d.lat,
      lng: d.lng,
      name: `${d.name || "Unnamed"} (${d.distance}m)`,
      color: "var(--color-accent-text)",
    })),
    ...osmResults.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      name: `${s.name} (${s.distance}m)`,
      color: "var(--color-muted)",
    })),
  ];

  if (step === "confirm" && confirm) {
    return (
      <>
        <AdminPage width="form">
          <AdminPageHeader
            title="Add destination"
            description={<>Source: {confirm.source}</>}
            breadcrumb={
              <nav
                aria-label="Breadcrumb"
                className="flex flex-wrap items-center gap-1.5 text-sm text-muted"
              >
                <Link
                  href="/admin/destinations"
                  className="transition-colors hover:text-ink hover:underline"
                >
                  Destinations
                </Link>
                <span aria-hidden>›</span>
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="transition-colors hover:text-ink hover:underline"
                >
                  Search
                </button>
                <span aria-hidden>›</span>
                <span className="text-ink-2" aria-current="page">
                  Confirm
                </span>
              </nav>
            }
          />

          <form
            className="mt-10 space-y-8"
            aria-label="Destination details"
            onSubmit={handleConfirmSubmit}
          >
            {/* Name */}
            <div>
              <Label htmlFor="destination-name">Name</Label>
              <Input
                id="destination-name"
                type="text"
                value={confirm.name}
                onChange={(e) =>
                  setConfirm({ ...confirm, name: e.target.value })
                }
                autoFocus
                required
              />
            </div>

            {/* Type */}
            <div>
              <Label htmlFor="destination-type">Type</Label>
              <Select
                id="destination-type"
                value={confirm.type}
                onChange={(e) =>
                  setConfirm({ ...confirm, type: e.target.value })
                }
                className="max-w-48"
              >
                <option value="point">Point</option>
                <option value="region">Region</option>
              </Select>
            </div>

            {/* Features */}
            <div>
              <Label htmlFor="destination-feature">Features</Label>
              <div className="flex flex-wrap items-center gap-2">
                {confirm.features.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-fill py-1 pl-3 pr-1.5 text-[13px] font-medium text-ink-2"
                  >
                    {f}
                    <button
                      type="button"
                      aria-label={`Remove ${f}`}
                      onClick={() =>
                        setConfirm({
                          ...confirm,
                          features: confirm.features.filter((x) => x !== f),
                        })
                      }
                      className="appearance-none rounded-full border-0 bg-transparent p-0 text-faint transition-colors hover:text-ink"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <Select
                  id="destination-feature"
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
                  className="max-h-8 max-w-44 text-xs"
                >
                  <option value="">+ Add feature</option>
                  {ALL_FEATURES.filter(
                    (f) => !confirm.features.includes(f)
                  ).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Elevation */}
            <div>
              <Label htmlFor="destination-elevation">Elevation</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="destination-elevation"
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
                        ? parseFloat(e.target.value) / 3.28084
                        : null,
                    })
                  }
                  placeholder="—"
                  className="max-w-32 font-mono-num tabular-nums"
                />
                <span className="text-sm text-muted">ft</span>
                <Button
                  onClick={handleLookupElevation}
                  disabled={lookingUpElevation}
                  variant="secondary"
                  size="sm"
                >
                  {lookingUpElevation ? "Looking up…" : "Auto-fill"}
                </Button>
              </div>
              {confirm.elevation != null && (
                <p className="mt-1 text-xs text-faint">
                  {Math.round(confirm.elevation)}m
                </p>
              )}
            </div>

            {/* Location */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-2">Location</p>
                <span className="font-mono-num text-xs text-faint">
                  {confirm.lat.toFixed(5)}, {confirm.lng.toFixed(5)}
                </span>
              </div>
              <p className="mb-2 text-xs text-muted">
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink-2">Boundary</p>
                <div className="flex items-center gap-2">
                  {boundary && !showBoundaryEditor && (
                    <span className="rounded-full border border-border bg-fill px-2.5 py-0.5 text-xs font-medium text-ink-2">
                      Boundary set
                    </span>
                  )}
                  {showBoundaryEditor ? (
                    <Button
                      onClick={() => setShowBoundaryEditor(false)}
                      variant="secondary"
                      size="sm"
                    >
                      Done
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setShowBoundaryEditor(true)}
                      variant="secondary"
                      size="sm"
                    >
                      {boundary ? "Edit boundary" : "Draw boundary"}
                    </Button>
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
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                onClick={() => setStep("pick")}
                variant="secondary"
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={saving || !confirm.name.trim()}
                variant="primary"
              >
                {saving ? "Creating…" : "Create destination"}
              </Button>
            </div>
          </form>
        </AdminPage>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // Step: pick location
  return (
    <>
      <main className="flex h-[calc(100dvh-99px)] flex-col bg-page lg:h-dvh">
        <header className="shrink-0 border-b border-hairline bg-page px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-sm text-muted"
            >
              <Link
                href="/admin/destinations"
                className="transition-colors hover:text-ink hover:underline"
              >
                Destinations
              </Link>
              <span aria-hidden>›</span>
              <span className="text-ink-2" aria-current="page">
                Add destination
              </span>
            </nav>

            <form
              aria-label="Search by coordinates"
              className="flex flex-wrap items-center gap-2"
              onSubmit={handleCoordinateSearch}
            >
              <Label htmlFor="destination-latitude" className="sr-only">
                Latitude
              </Label>
              <Input
                id="destination-latitude"
                type="number"
                inputMode="decimal"
                min={-90}
                max={90}
                step="any"
                placeholder="Latitude"
                value={latitudeInput}
                onChange={(event) => setLatitudeInput(event.target.value)}
                aria-invalid={Boolean(coordinateError)}
                aria-describedby={coordinateError ? "coordinate-error" : undefined}
                className="max-w-32 font-mono-num tabular-nums"
              />
              <Label htmlFor="destination-longitude" className="sr-only">
                Longitude
              </Label>
              <Input
                id="destination-longitude"
                type="number"
                inputMode="decimal"
                min={-180}
                max={180}
                step="any"
                placeholder="Longitude"
                value={longitudeInput}
                onChange={(event) => setLongitudeInput(event.target.value)}
                aria-invalid={Boolean(coordinateError)}
                aria-describedby={coordinateError ? "coordinate-error" : undefined}
                className="max-w-32 font-mono-num tabular-nums"
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </div>
          {coordinateError ? (
            <p
              id="coordinate-error"
              className="mt-2 text-sm text-alert lg:text-right"
              role="alert"
            >
              {coordinateError}
            </p>
          ) : null}
        </header>

        <div className="relative min-h-0 flex-1 lg:flex">
        {/* Map */}
        <div className="absolute inset-0 lg:relative lg:flex-1">
          <DestinationSearchMap
            onClick={handleMapClick}
            clickedPoint={clickedPoint}
            markers={mapMarkers}
          />
          {!clickedPoint && (
            <div className="pointer-events-none absolute left-14 right-4 top-4 z-[500] max-w-md rounded-ctl bg-page/90 px-4 py-2 text-center text-sm text-ink-2 shadow-float backdrop-blur-sm lg:left-1/2 lg:right-auto lg:w-[calc(100%-2rem)] lg:-translate-x-1/2">
              Click the map or enter coordinates above to search nearby
            </div>
          )}
        </div>

        {/* Results panel */}
        {clickedPoint && (
          <aside
            aria-labelledby="nearby-destinations-heading"
            className="absolute inset-x-3 bottom-3 z-[1000] flex max-h-[60%] flex-col overflow-hidden rounded-media border border-border bg-page shadow-float lg:static lg:z-auto lg:max-h-none lg:w-96 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none"
          >
            <div className="border-b border-hairline p-4">
              <h2
                id="nearby-destinations-heading"
                className="text-sm font-medium text-ink"
              >
                Nearby destinations
              </h2>
              <p className="mt-0.5 font-mono text-xs text-muted">
                {clickedPoint.lat.toFixed(5)}, {clickedPoint.lng.toFixed(5)}
              </p>
            </div>

            {searchError ? (
              <p
                className="border-b border-hairline px-4 py-3 text-sm text-alert"
                role="alert"
              >
                {searchError}
              </p>
            ) : null}

            {searching ? (
              <div
                className="p-8 text-center text-sm text-muted"
                role="status"
              >
                Searching…
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* Existing in DB */}
                {existing.length > 0 && (
                  <section className="border-b border-hairline py-3">
                    <h3 className="mb-1 px-4 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                      In your database
                    </h3>
                    <div className="divide-y divide-hairline">
                      {existing.map((d) => (
                        <button
                          type="button"
                          key={d.id}
                          onClick={() => handleSelectExisting(d)}
                          className="w-full px-4 py-3 text-left transition-colors hover:bg-fill"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-medium text-accent-text">
                                {d.name || "Unnamed"}
                              </div>
                              <div className="mt-0.5 text-xs text-muted">
                                {d.elevation
                                  ? `${Math.round(d.elevation * 3.28084).toLocaleString()} ft`
                                  : ""}
                                {d.features.length > 0 &&
                                  ` · ${d.features.join(", ")}`}
                              </div>
                            </div>
                            <span className="ml-2 shrink-0 font-mono-num text-xs text-faint">
                              {d.distance}m
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* OSM results */}
                <section className="py-3">
                  <h3 className="mb-1 px-4 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                    From OpenStreetMap
                  </h3>
                  {osmResults.length === 0 ? (
                    <p className="px-4 py-2 text-sm text-faint">
                      {osmSearchFailed
                        ? "OpenStreetMap results could not be loaded"
                        : "No named features found nearby"}
                    </p>
                  ) : (
                    <div className="divide-y divide-hairline">
                      {osmResults.map((s) => (
                        <button
                          type="button"
                          key={s.osm_id}
                          onClick={() => handleSelectOSM(s)}
                          className="w-full px-4 py-3 text-left transition-colors hover:bg-fill"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-medium text-ink">
                                {s.name}
                              </div>
                              <div className="mt-0.5 text-xs text-muted">
                                {s.elevation
                                  ? `${Math.round(s.elevation * 3.28084).toLocaleString()} ft · `
                                  : ""}
                                <span className="text-muted">
                                  {s.osm_tags}
                                </span>
                              </div>
                            </div>
                            <span className="ml-2 shrink-0 font-mono-num text-xs text-faint">
                              {s.distance}m
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {/* Create custom */}
                <div className="border-t border-hairline p-4">
                  <Button
                    onClick={handleCreateCustom}
                    variant="secondary"
                    className="w-full"
                  >
                    Create at this location
                  </Button>
                </div>
              </div>
            )}
          </aside>
        )}
        </div>
      </main>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
