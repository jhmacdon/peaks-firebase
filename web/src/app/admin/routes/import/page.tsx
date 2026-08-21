"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import AdminGuard from "../../../../components/admin-guard";
import { AdminPage, AdminPageHeader } from "../../../../components/admin/admin-page";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input, Label, Select } from "../../../../components/ui/field";
import { importRouteAsPending } from "../../../../lib/actions/route-import";
import type { RouteProvenanceInput } from "../../../../lib/route-provenance";

interface ImportResult {
  name: string;
  routeId?: string;
  error?: string;
  stats?: { distance: number; gain: number; loss: number };
}

function formatRouteName(raw: string): string {
  const parts = raw.split(" - ").map((part) => part.trim());
  if (parts.length < 2) return raw;
  const peak = parts[0];
  const trail = parts.slice(1).join(" ");
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(mount|mt\.?|peak|mountain|trail|route|standard|climber'?s?)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const peakNorm = normalize(peak);
  const trailNorm = normalize(trail);
  if (peakNorm === trailNorm || trailNorm.includes(peakNorm) || peakNorm.includes(trailNorm)) {
    return `${peak} Trail`;
  }
  let cleanTrail = trail;
  for (const word of peak.split(" ")) {
    if (word.length > 2) cleanTrail = cleanTrail.replace(new RegExp(`\\b${word}\\b`, "gi"), "").trim();
  }
  cleanTrail = cleanTrail.replace(/^\s*[-–—]\s*/, "").replace(/\s+/g, " ").trim();
  if (!cleanTrail || cleanTrail.toLowerCase() === "trail" || cleanTrail.toLowerCase() === "route") {
    return `${peak} Trail`;
  }
  return `${peak} via ${cleanTrail}`;
}

export default function ImportRoutesPage() {
  return (
    <AdminGuard>
      <ImportContent />
    </AdminGuard>
  );
}

function ImportContent() {
  const [files, setFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [sourceKind, setSourceKind] = useState("gpx");
  const [sourceUrl, setSourceUrl] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [containsOsmGeometry, setContainsOsmGeometry] = useState(false);
  const [osmWayIds, setOsmWayIds] = useState("");
  const [osmWayUrls, setOsmWayUrls] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const gpxFiles = Array.from(fileList).filter(
      (file) => file.name.endsWith(".gpx") || file.name.endsWith(".GPX")
    );
    setFiles((current) => [...current, ...gpxFiles]);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    handleFiles(event.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleImport = async () => {
    const hasProvenance = Boolean(
      sourceUrl.trim() ||
        licenseName.trim() ||
        licenseUrl.trim() ||
        attribution.trim() ||
        containsOsmGeometry
    );
    if (
      hasProvenance &&
      (!sourceUrl.trim() || !licenseName.trim() || !licenseUrl.trim() || !attribution.trim())
    ) {
      alert("Route provenance needs a source URL, license name, license URL, and attribution.");
      return;
    }
    if (containsOsmGeometry && !osmWayIds.trim()) {
      alert("OpenStreetMap geometry needs every contributing OSM way ID.");
      return;
    }

    const provenance: RouteProvenanceInput | undefined = hasProvenance
      ? {
          source_kind: sourceKind.trim() || "gpx",
          source_url: sourceUrl.trim(),
          license_name: licenseName.trim() || undefined,
          license_url: licenseUrl.trim() || undefined,
          attribution: attribution.trim() || undefined,
          contains_osm_geometry: containsOsmGeometry,
          osm_way_ids: osmWayIds
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number),
          osm_way_urls: osmWayUrls.split(/[,\s]+/).filter(Boolean),
        }
      : undefined;

    setImporting(true);
    setProgress(0);
    setResults([]);

    const newResults: ImportResult[] = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const rawName = file.name
        .replace(/\.gpx$/i, "")
        .replace(/--/g, " - ")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const name = formatRouteName(rawName);

      try {
        const content = await file.text();
        const result = await importRouteAsPending(content, name, provenance);
        newResults.push({
          name: result.name,
          routeId: result.routeId,
          stats: {
            distance: result.validation.stats.distance,
            gain: result.validation.stats.gain,
            loss: result.validation.stats.loss,
          },
        });
      } catch (error: unknown) {
        newResults.push({
          name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      setProgress(index + 1);
      setResults([...newResults]);
    }

    setImporting(false);
  };

  const succeeded = results.filter((result) => result.routeId);
  const failed = results.filter((result) => result.error);

  return (
    <AdminPage width="form">
      <AdminPageHeader
        title="Import GPX routes"
        description="Upload GPX files as pending routes. Peaks adds elevation and destination matches, then sends each route to review without changing existing routes or segments."
        breadcrumb={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
            <Link href="/admin/routes" className="text-accent-text hover:underline">
              Routes
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink-2">Import</span>
          </nav>
        }
      />

      {results.length === 0 ? (
        <ImportSetup
          sourceKind={sourceKind}
          setSourceKind={setSourceKind}
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          licenseName={licenseName}
          setLicenseName={setLicenseName}
          licenseUrl={licenseUrl}
          setLicenseUrl={setLicenseUrl}
          attribution={attribution}
          setAttribution={setAttribution}
          containsOsmGeometry={containsOsmGeometry}
          setContainsOsmGeometry={setContainsOsmGeometry}
          osmWayIds={osmWayIds}
          setOsmWayIds={setOsmWayIds}
          osmWayUrls={osmWayUrls}
          setOsmWayUrls={setOsmWayUrls}
          files={files}
          setFiles={setFiles}
          handleFiles={handleFiles}
          handleDrop={handleDrop}
          removeFile={removeFile}
          importing={importing}
          progress={progress}
          handleImport={handleImport}
          fileInputRef={fileInputRef}
        />
      ) : (
        <ImportResults
          importing={importing}
          progress={progress}
          fileCount={files.length}
          results={results}
          succeededCount={succeeded.length}
          failedCount={failed.length}
          onImportMore={() => {
            setResults([]);
            setFiles([]);
            setProgress(0);
          }}
        />
      )}
    </AdminPage>
  );
}

function ImportSetup({
  sourceKind,
  setSourceKind,
  sourceUrl,
  setSourceUrl,
  licenseName,
  setLicenseName,
  licenseUrl,
  setLicenseUrl,
  attribution,
  setAttribution,
  containsOsmGeometry,
  setContainsOsmGeometry,
  osmWayIds,
  setOsmWayIds,
  osmWayUrls,
  setOsmWayUrls,
  files,
  setFiles,
  handleFiles,
  handleDrop,
  removeFile,
  importing,
  progress,
  handleImport,
  fileInputRef,
}: {
  sourceKind: string;
  setSourceKind: (value: string) => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  licenseName: string;
  setLicenseName: (value: string) => void;
  licenseUrl: string;
  setLicenseUrl: (value: string) => void;
  attribution: string;
  setAttribution: (value: string) => void;
  containsOsmGeometry: boolean;
  setContainsOsmGeometry: (value: boolean) => void;
  osmWayIds: string;
  setOsmWayIds: (value: string) => void;
  osmWayUrls: string;
  setOsmWayUrls: (value: string) => void;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  handleFiles: (files: FileList | null) => void;
  handleDrop: (event: React.DragEvent) => void;
  removeFile: (index: number) => void;
  importing: boolean;
  progress: number;
  handleImport: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const chooseFiles = () => fileInputRef.current?.click();

  return (
    <>
      <section
        aria-labelledby="route-source-heading"
        className="mt-10 rounded-media border border-border bg-surface p-5 sm:p-6"
      >
        <h2 id="route-source-heading" className="text-lg font-medium text-ink">
          Route source
        </h2>
        <p className="mt-1 text-sm text-muted">
          Add the source used for every file in this import. Leave it blank for a local GPX with no public source.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="route-source-kind">Source kind</Label>
            <Select
              id="route-source-kind"
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value)}
            >
              <option value="gpx">GPX</option>
              <option value="openstreetmap">OpenStreetMap</option>
              <option value="usgs">USGS</option>
              <option value="manual">Manual</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <Field
            id="route-source-url"
            label="Source URL"
            type="url"
            value={sourceUrl}
            onChange={setSourceUrl}
            placeholder="https://…"
          />
        </div>

        <label className="mt-5 flex items-start gap-3 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={containsOsmGeometry}
            onChange={(event) => {
              const checked = event.target.checked;
              setContainsOsmGeometry(checked);
              if (checked) {
                setSourceKind("openstreetmap");
                setLicenseName("Open Data Commons Open Database License (ODbL) 1.0");
                setLicenseUrl("https://opendatacommons.org/licenses/odbl/1-0/");
                setAttribution("© OpenStreetMap contributors");
              }
            }}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>Route geometry includes OpenStreetMap data</span>
        </label>

        {sourceUrl.trim() || containsOsmGeometry ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field
              id="route-license-name"
              label="License name"
              value={licenseName}
              onChange={setLicenseName}
            />
            <Field
              id="route-license-url"
              label="License URL"
              type="url"
              value={licenseUrl}
              onChange={setLicenseUrl}
            />
            <Field
              id="route-attribution"
              label="Attribution"
              value={attribution}
              onChange={setAttribution}
            />
            <Field
              id="route-osm-way-ids"
              label="OSM way IDs"
              value={osmWayIds}
              onChange={setOsmWayIds}
              placeholder="824208041, 1089371018"
            />
            <Field
              id="route-osm-way-urls"
              label="OSM way URLs"
              type="url"
              value={osmWayUrls}
              onChange={setOsmWayUrls}
              placeholder="https://www.openstreetmap.org/way/…"
              className="sm:col-span-2"
            />
          </div>
        ) : null}
      </section>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className="mt-10 rounded-media border border-dashed border-border bg-page px-6"
      >
        <EmptyState
          title="Drop GPX files here"
          description="You can add one file or a batch."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={chooseFiles}
            >
              Choose files
            </Button>
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx"
          multiple
          onChange={(event) => handleFiles(event.target.files)}
          className="hidden"
        />
      </div>

      {files.length > 0 ? (
        <section className="mt-10" aria-labelledby="selected-files-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="selected-files-heading" className="font-medium text-ink">
              <span className="font-mono-num tabular-nums">{files.length}</span> file
              {files.length !== 1 ? "s" : ""} selected
            </h2>
            <Button type="button" variant="quiet" size="sm" onClick={() => setFiles([])}>
              Clear all
            </Button>
          </div>

          <div className="mt-4 max-h-64 overflow-y-auto rounded-media border border-border bg-page">
            <div className="divide-y divide-hairline">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate text-ink-2">{file.name}</span>
                  <Button type="button" variant="danger" size="sm" onClick={() => removeFile(index)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Button type="button" className="mt-5 w-full" onClick={handleImport} disabled={importing}>
            {importing
              ? `Importing ${progress}/${files.length}…`
              : `Import ${files.length} route${files.length !== 1 ? "s" : ""} as pending`}
          </Button>
        </section>
      ) : null}
    </>
  );
}

function ImportResults({
  importing,
  progress,
  fileCount,
  results,
  succeededCount,
  failedCount,
  onImportMore,
}: {
  importing: boolean;
  progress: number;
  fileCount: number;
  results: ImportResult[];
  succeededCount: number;
  failedCount: number;
  onImportMore: () => void;
}) {
  return (
    <section className="mt-10" aria-labelledby="import-results-heading" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="import-results-heading" className="text-lg font-medium text-ink">
          {importing ? (
            <>
              Processing <span className="font-mono-num tabular-nums">{progress}/{fileCount}</span>
            </>
          ) : (
            "Import complete"
          )}
        </h2>
        {!importing ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-success">
              <span className="font-mono-num tabular-nums">{succeededCount}</span> imported
            </span>
            {failedCount > 0 ? (
              <span className="text-alert">
                <span className="font-mono-num tabular-nums">{failedCount}</span> failed
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {importing ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-fill" aria-hidden="true">
          <div
            className="h-full bg-ink-2 transition-all duration-300"
            style={{ width: `${(progress / fileCount) * 100}%` }}
          />
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-media border border-border bg-page">
        <div className="divide-y divide-hairline">
          {results.map((result, index) => (
            <div
              key={`${result.name}-${index}`}
              className={`flex items-center justify-between gap-4 px-4 py-4 text-sm ${result.error ? "bg-alert/10" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-ink">{result.name}</p>
                  <Badge tone={result.error ? "red" : "emerald"}>
                    {result.error ? "Failed" : "Imported"}
                  </Badge>
                </div>
                {result.stats ? (
                  <p className="mt-1 font-mono-num text-xs tabular-nums text-muted">
                    {(result.stats.distance / 1609.34).toFixed(1)} mi /{" "}
                    {Math.round(result.stats.gain * 3.28084).toLocaleString()} ft gain
                  </p>
                ) : null}
                {result.error ? <p className="mt-1 text-xs text-alert">{result.error}</p> : null}
              </div>
              {result.routeId ? (
                <Link
                  href={`/admin/routes/${result.routeId}`}
                  className="shrink-0 text-sm font-medium text-accent-text hover:underline"
                >
                  Review
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {!importing ? (
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onImportMore}>
            Import more
          </Button>
          <Button href="/admin/routes">Review pending routes</Button>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
