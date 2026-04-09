"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import AdminGuard from "../../../components/admin-guard";
import AdminNav from "../../../components/admin-nav";
import {
  getDestinations,
  bulkImportDestinations,
  type DestinationRow,
  type SortField,
  type SortDir,
  type BulkImportWaypoint,
  type BulkImportResult,
} from "../../../lib/actions/destinations";
import { parseGPX, type GPXWaypoint } from "../../../lib/gpx";

export default function DestinationsPage() {
  return (
    <AdminGuard>
      <DestinationsContent />
    </AdminGuard>
  );
}

function DestinationsContent() {
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterFeature, setFilterFeature] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const pageSize = 50;

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importWaypoints, setImportWaypoints] = useState<(GPXWaypoint & { feature: string; include: boolean })[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (file: File) => {
    file.text().then((text) => {
      const parsed = parseGPX(text);
      if (parsed.waypoints.length === 0) {
        alert("No waypoints found in this GPX file. Only <wpt> elements are supported for destination import.");
        return;
      }
      setImportWaypoints(
        parsed.waypoints.map((w) => ({
          ...w,
          feature: w.symbol === "trailhead" || w.name?.toLowerCase().includes("trailhead") ? "trailhead" : "summit",
          include: true,
        }))
      );
      setImportResult(null);
      setShowImport(true);
    });
  };

  const handleImportDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".gpx")) {
      handleImportFile(file);
    }
  };

  const handleRunImport = async () => {
    const toImport: BulkImportWaypoint[] = importWaypoints
      .filter((w) => w.include && w.name?.trim())
      .map((w) => ({
        name: w.name!.trim(),
        lat: w.lat,
        lng: w.lng,
        ele: w.ele,
        feature: w.feature,
      }));

    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const result = await bulkImportDestinations(toImport);
      setImportResult(result);
      if (result.imported > 0) fetchDestinations();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
    setPage(0);
  };

  const fetchDestinations = useCallback(async () => {
    setLoading(true);
    const filters: { type?: string; feature?: string } = {};
    if (filterType) filters.type = filterType;
    if (filterFeature) filters.feature = filterFeature;
    const result = await getDestinations(
      search, pageSize, page * pageSize, filters, { field: sortField, dir: sortDir }
    );
    setDestinations(result.destinations);
    setTotal(result.total);
    setLoading(false);
  }, [search, page, filterType, filterFeature, sortField, sortDir]);

  useEffect(() => {
    fetchDestinations();
  }, [fetchDestinations]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchDestinations();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Destinations</h2>
            <p className="text-sm text-gray-500 mt-1">
              {total.toLocaleString()} total destinations
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowImport(true); setImportWaypoints([]); setImportResult(null); }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Import GPX
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".gpx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
            />
          </div>
        </div>

        {/* Import Panel */}
        {showImport && (
          <div className="mb-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Import Destinations from GPX</h3>
              <button
                onClick={() => setShowImport(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
              >
                &times;
              </button>
            </div>

            {importWaypoints.length === 0 && !importResult ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleImportDrop}
                onClick={() => importFileRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
              >
                <p className="text-gray-500 mb-1">Drag & drop a GPX file here</p>
                <p className="text-xs text-gray-400">or click to browse. Only &lt;wpt&gt; waypoints are imported.</p>
              </div>
            ) : importResult ? (
              <div className="space-y-3">
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {importResult.imported} imported
                  </span>
                  <span className="text-gray-500">
                    {importResult.skipped} skipped (duplicates)
                  </span>
                </div>
                {importResult.results.filter(r => r.status === "skipped" && r.reason).length > 0 && (
                  <div className="text-sm text-amber-600 dark:text-amber-400">
                    {importResult.results.filter(r => r.status === "skipped").length} skipped:
                    <ul className="list-disc ml-5 mt-1">
                      {importResult.results.filter(r => r.status === "skipped").slice(0, 5).map((r, i) => (
                        <li key={i}>{r.name}: {r.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setImportWaypoints([]); setImportResult(null); }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Import More
                  </button>
                  <button
                    onClick={() => setShowImport(false)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-gray-500 mb-2">
                  {importWaypoints.filter((w) => w.include).length} of {importWaypoints.length} waypoints selected
                </div>
                <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                      <tr className="text-left text-xs text-gray-500">
                        <th className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={importWaypoints.every((w) => w.include)}
                            onChange={(e) =>
                              setImportWaypoints((ws) =>
                                ws.map((w) => ({ ...w, include: e.target.checked }))
                              )
                            }
                          />
                        </th>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Feature</th>
                        <th className="px-3 py-2">Elevation</th>
                        <th className="px-3 py-2">Coordinates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importWaypoints.map((w, i) => (
                        <tr
                          key={i}
                          className={`border-t border-gray-100 dark:border-gray-800/50 ${!w.include ? "opacity-40" : ""}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={w.include}
                              onChange={(e) =>
                                setImportWaypoints((ws) =>
                                  ws.map((ww, j) =>
                                    j === i ? { ...ww, include: e.target.checked } : ww
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2 font-medium">{w.name || "Unnamed"}</td>
                          <td className="px-3 py-2">
                            <select
                              value={w.feature}
                              onChange={(e) =>
                                setImportWaypoints((ws) =>
                                  ws.map((ww, j) =>
                                    j === i ? { ...ww, feature: e.target.value } : ww
                                  )
                                )
                              }
                              className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-700 rounded bg-transparent"
                            >
                              <option value="summit">Summit</option>
                              <option value="trailhead">Trailhead</option>
                              <option value="volcano">Volcano</option>
                              <option value="fire-lookout">Fire Lookout</option>
                              <option value="hut">Hut</option>
                              <option value="lookout">Lookout</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {w.ele ? `${Math.round(w.ele * 3.28084).toLocaleString()} ft` : "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">
                            {w.lat.toFixed(4)}, {w.lng.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRunImport}
                    disabled={importing || importWaypoints.filter((w) => w.include).length === 0}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {importing ? "Importing..." : `Import ${importWaypoints.filter((w) => w.include).length} Destinations`}
                  </button>
                  <button
                    onClick={() => { setImportWaypoints([]); setImportResult(null); }}
                    className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search destinations by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </form>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          >
            <option value="">All Types</option>
            <option value="point">Point</option>
            <option value="region">Region</option>
          </select>
          <select
            value={filterFeature}
            onChange={(e) => { setFilterFeature(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          >
            <option value="">All Features</option>
            <option value="summit">Summit</option>
            <option value="trailhead">Trailhead</option>
            <option value="volcano">Volcano</option>
            <option value="fire-lookout">Fire Lookout</option>
            <option value="hut">Hut</option>
            <option value="lookout">Lookout</option>
          </select>
        </div>

        {loading ? (
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        ) : destinations.length === 0 ? (
          <div className="text-gray-500 py-12 text-center">
            No destinations found
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                    <SortHeader field="name" label="Name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="elevation" label="Elevation" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="prominence" label="Prominence" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 font-medium text-gray-500">
                      Features
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500">
                      Location
                    </th>
                    <SortHeader field="route_count" label="Routes" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="list_count" label="Lists" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {destinations.map((dest) => (
                    <tr
                      key={dest.id}
                      className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/destinations/${dest.id}`}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                        >
                          {dest.name || "Unnamed"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {dest.elevation
                          ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {dest.prominence
                          ? `${Math.round(dest.prominence * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(dest.features) &&
                            dest.features.map((f) => (
                              <span
                                key={f}
                                className="inline-block px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                              >
                                {f}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                        {dest.state_code || dest.country_code || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {dest.route_count}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {dest.list_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > pageSize && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500">
                  Showing {page * pageSize + 1}–
                  {Math.min((page + 1) * pageSize, total)} of{" "}
                  {total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * pageSize >= total}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <th className="px-4 py-3 font-medium text-gray-500">
      <button
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        {label}
        <span className={`text-xs ${active ? "text-blue-600 dark:text-blue-400" : "text-gray-300 dark:text-gray-600"}`}>
          {active ? (sortDir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
        </span>
      </button>
    </th>
  );
}
