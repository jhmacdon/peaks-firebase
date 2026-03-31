"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";
import { importRouteAsPending } from "@/lib/actions/route-import";

interface ImportResult {
  name: string;
  routeId?: string;
  error?: string;
  stats?: { distance: number; gain: number; loss: number };
}

function formatRouteName(raw: string): string {
  const parts = raw.split(" - ").map(s => s.trim());
  if (parts.length < 2) return raw;
  const peak = parts[0];
  const trail = parts.slice(1).join(" ");
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\b(mount|mt\.?|peak|mountain|trail|route|standard|climber'?s?)\b/g, "").replace(/\s+/g, " ").trim();
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
  if (!cleanTrail || cleanTrail.toLowerCase() === "trail" || cleanTrail.toLowerCase() === "route") return `${peak} Trail`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const gpxFiles = Array.from(fileList).filter(
      (f) => f.name.endsWith(".gpx") || f.name.endsWith(".GPX")
    );
    setFiles((prev) => [...prev, ...gpxFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    setImporting(true);
    setProgress(0);
    setResults([]);

    const newResults: ImportResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawName = file.name.replace(/\.gpx$/i, "").replace(/--/g, " - ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
      const name = formatRouteName(rawName);

      try {
        const content = await file.text();
        const result = await importRouteAsPending(content, name);
        newResults.push({
          name: result.name,
          routeId: result.routeId,
          stats: {
            distance: result.validation.stats.distance,
            gain: result.validation.stats.gain,
            loss: result.validation.stats.loss,
          },
        });
      } catch (err: unknown) {
        newResults.push({ name, error: err instanceof Error ? err.message : "Unknown error" });
      }

      setProgress(i + 1);
      setResults([...newResults]);
    }

    setImporting(false);
  };

  const succeeded = results.filter((r) => r.routeId);
  const failed = results.filter((r) => r.error);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/admin/routes" className="hover:text-gray-900 dark:hover:text-gray-100">
            Routes
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">Import</span>
        </div>

        <h2 className="text-2xl font-semibold mb-2">Import GPX Routes</h2>
        <p className="text-sm text-gray-500 mb-8">
          Upload GPX files to import as pending routes. Each route will be processed with
          DEM elevations and destination matching, then placed in the review queue.
          No existing routes or segments will be affected.
        </p>

        {results.length === 0 ? (
          <>
            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
            >
              <div className="text-4xl mb-3 text-gray-300">+</div>
              <div className="font-medium">Drop GPX files here</div>
              <div className="text-sm text-gray-500 mt-1">or click to browse</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">{files.length} file{files.length !== 1 ? "s" : ""} selected</h3>
                  <button
                    onClick={() => setFiles([])}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {files.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 text-sm"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        onClick={() => removeFile(i)}
                        className="text-gray-400 hover:text-red-500 ml-2 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {importing
                    ? `Importing ${progress}/${files.length}...`
                    : `Import ${files.length} Route${files.length !== 1 ? "s" : ""} as Pending`}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Results */}
            <div className="mb-6 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">
                  {importing ? `Processing ${progress}/${files.length}...` : "Import complete"}
                </span>
                {!importing && (
                  <>
                    <span className="text-green-600">{succeeded.length} imported</span>
                    {failed.length > 0 && (
                      <span className="text-red-600">{failed.length} failed</span>
                    )}
                  </>
                )}
              </div>
              {importing && (
                <div className="mt-3 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${(progress / files.length) * 100}%` }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              {results.map((result, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm ${
                    result.error
                      ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                      : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{result.name}</div>
                    {result.stats && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {(result.stats.distance / 1609.34).toFixed(1)} mi
                        {" / "}
                        {Math.round(result.stats.gain * 3.28084).toLocaleString()} ft gain
                      </div>
                    )}
                    {result.error && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        {result.error}
                      </div>
                    )}
                  </div>
                  {result.routeId && (
                    <Link
                      href={`/admin/routes/${result.routeId}`}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-xs shrink-0 ml-2"
                    >
                      Review
                    </Link>
                  )}
                </div>
              ))}
            </div>

            {!importing && (
              <div className="mt-6 flex gap-3">
                <Link
                  href="/admin/routes"
                  className="flex-1 py-2.5 text-center bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Review Pending Routes
                </Link>
                <button
                  onClick={() => { setResults([]); setFiles([]); setProgress(0); }}
                  className="px-4 py-2.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Import More
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
