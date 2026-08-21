"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import AdminGuard from "../../../components/admin-guard";
import {
  AdminPage,
  AdminPageHeader,
  AdminTableFrame,
} from "../../../components/admin/admin-page";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Input, Select } from "../../../components/ui/field";
import { StatCluster } from "../../../components/ui/stat";
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
import { LOADING_LABEL } from "../../../lib/constants";

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

  const selectedWaypointCount = importWaypoints.filter((w) => w.include).length;

  return (
    <AdminPage className="space-y-10">
      <AdminPageHeader
        title="Destinations"
        description="Search, filter, and maintain the places in Peaks."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowImport(true);
                setImportWaypoints([]);
                setImportResult(null);
              }}
            >
              Import GPX
            </Button>
            <Button href="/admin/destinations/new">Add destination</Button>
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
          </>
        }
      />

      <StatCluster
        value={total.toLocaleString()}
        label="Destinations"
        scale="topline"
      />

      {showImport && (
        <section className="space-y-5" aria-labelledby="destination-import-title">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="destination-import-title" className="text-lg font-medium text-ink">
                Import destinations from GPX
              </h2>
              <p className="mt-1 text-sm text-muted">
                Review every waypoint before it joins the catalog.
              </p>
            </div>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setShowImport(false)}
              aria-label="Close destination import"
            >
              Close
            </Button>
          </div>

          {importWaypoints.length === 0 && !importResult ? (
            <div
              role="button"
              tabIndex={0}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleImportDrop}
              onClick={() => importFileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  importFileRef.current?.click();
                }
              }}
              className="cursor-pointer rounded-media border border-dashed border-border bg-surface px-6 py-12 text-center transition-colors hover:border-ink-2"
            >
              <p className="font-medium text-ink-2">Drop a GPX file here</p>
              <p className="mt-1 text-sm text-muted">
                Or choose a file. Only &lt;wpt&gt; waypoints are imported.
              </p>
            </div>
          ) : importResult ? (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-x-12 gap-y-6">
                <StatCluster
                  value={importResult.imported.toLocaleString()}
                  label="Imported"
                  scale="card"
                />
                <StatCluster
                  value={importResult.skipped.toLocaleString()}
                  label="Skipped as duplicates"
                  scale="card"
                />
              </div>
              {importResult.results.filter((result) => result.status === "skipped" && result.reason)
                .length > 0 && (
                <div className="text-sm text-muted">
                  <p className="font-medium text-ink-2">
                    {importResult.results.filter((result) => result.status === "skipped").length}{" "}
                    skipped
                  </p>
                  <ul className="mt-2 ml-5 list-disc space-y-1">
                    {importResult.results
                      .filter((result) => result.status === "skipped")
                      .slice(0, 5)
                      .map((result, index) => (
                        <li key={index}>
                          {result.name}: {result.reason}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setImportWaypoints([]);
                    setImportResult(null);
                  }}
                >
                  Import more
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setShowImport(false)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-muted">
                {selectedWaypointCount} of {importWaypoints.length} waypoints selected
              </p>
              <div className="max-h-80 overflow-y-auto">
                <AdminTableFrame>
                  <table className="min-w-[720px] w-full text-sm">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="text-left text-xs text-muted">
                        <th scope="col" className="w-12 px-3 py-2.5 font-medium">
                          <input
                            type="checkbox"
                            aria-label="Select all waypoints"
                            checked={importWaypoints.every((w) => w.include)}
                            onChange={(e) =>
                              setImportWaypoints((waypoints) =>
                                waypoints.map((waypoint) => ({
                                  ...waypoint,
                                  include: e.target.checked,
                                }))
                              )
                            }
                            className="accent-accent"
                          />
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Name</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Feature</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Elevation</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Coordinates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importWaypoints.map((waypoint, index) => (
                        <tr
                          key={index}
                          className={`border-t border-hairline transition-colors hover:bg-surface ${
                            !waypoint.include ? "opacity-40" : ""
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Include ${waypoint.name || "unnamed waypoint"}`}
                              checked={waypoint.include}
                              onChange={(e) =>
                                setImportWaypoints((waypoints) =>
                                  waypoints.map((current, currentIndex) =>
                                    currentIndex === index
                                      ? { ...current, include: e.target.checked }
                                      : current
                                  )
                                )
                              }
                              className="accent-accent"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-ink">
                            {waypoint.name || "Unnamed"}
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              value={waypoint.feature}
                              aria-label={`Feature for ${waypoint.name || "unnamed waypoint"}`}
                              onChange={(e) =>
                                setImportWaypoints((waypoints) =>
                                  waypoints.map((current, currentIndex) =>
                                    currentIndex === index
                                      ? { ...current, feature: e.target.value }
                                      : current
                                  )
                                )
                              }
                              className="min-w-36"
                            >
                              <option value="summit">Summit</option>
                              <option value="trailhead">Trailhead</option>
                              <option value="volcano">Volcano</option>
                              <option value="fire-lookout">Fire lookout</option>
                              <option value="hut">Hut</option>
                              <option value="lookout">Lookout</option>
                              <option value="lake">Lake</option>
                              <option value="landform">Landform</option>
                              <option value="viewpoint">Viewpoint</option>
                              <option value="waterfall">Waterfall</option>
                              <option value="campsite">Campsite</option>
                            </Select>
                          </td>
                          <td className="px-3 py-2.5 font-mono-num tabular-nums text-ink-2">
                            {waypoint.ele != null
                              ? `${Math.round(waypoint.ele * 3.28084).toLocaleString()} ft`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono-num text-xs tabular-nums text-muted">
                            {waypoint.lat.toFixed(4)}, {waypoint.lng.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableFrame>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleRunImport}
                  disabled={importing || selectedWaypointCount === 0}
                >
                  {importing ? "Importing…" : `Import ${selectedWaypointCount} destinations`}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setImportWaypoints([]);
                    setImportResult(null);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="space-y-5" aria-label="Destination filters and results">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form onSubmit={handleSearch} className="min-w-0 flex-1">
            <Input
              type="search"
              aria-label="Search destinations"
              placeholder="Search destinations by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
          </form>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex">
            <Select
              value={filterType}
              aria-label="Filter by destination type"
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(0);
              }}
              className="sm:w-40"
            >
              <option value="">All types</option>
              <option value="point">Point</option>
              <option value="region">Region</option>
            </Select>
            <Select
              value={filterFeature}
              aria-label="Filter by destination feature"
              onChange={(e) => {
                setFilterFeature(e.target.value);
                setPage(0);
              }}
              className="sm:w-44"
            >
              <option value="">All features</option>
              <option value="summit">Summit</option>
              <option value="trailhead">Trailhead</option>
              <option value="volcano">Volcano</option>
              <option value="fire-lookout">Fire lookout</option>
              <option value="hut">Hut</option>
              <option value="lookout">Lookout</option>
              <option value="lake">Lake</option>
              <option value="landform">Landform</option>
              <option value="viewpoint">Viewpoint</option>
              <option value="waterfall">Waterfall</option>
              <option value="campsite">Campsite</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="py-14 text-center text-sm text-muted">{LOADING_LABEL}</div>
        ) : destinations.length === 0 ? (
          <EmptyState
            title="No destinations found"
            description="Try a broader search or clear a filter."
          />
        ) : (
          <>
            <AdminTableFrame>
              <table className="min-w-[920px] w-full text-sm">
                <thead className="bg-surface">
                  <tr className="border-b border-hairline text-left">
                    <SortHeader field="name" label="Name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="elevation" label="Elevation" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="prominence" label="Prominence" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Features</th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Location</th>
                    <SortHeader field="route_count" label="Routes" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader field="list_count" label="Lists" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {destinations.map((destination) => (
                    <tr
                      key={destination.id}
                      className="border-b border-hairline transition-colors last:border-b-0 hover:bg-surface"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/destinations/${destination.id}`}
                          className="font-medium text-accent-text hover:underline"
                        >
                          {destination.name || "Unnamed"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {destination.elevation
                          ? `${Math.round(destination.elevation * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {destination.prominence
                          ? `${Math.round(destination.prominence * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {Array.isArray(destination.features) &&
                            destination.features.map((feature) => (
                              <Badge key={feature}>{feature}</Badge>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {destination.state_code || destination.country_code || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {destination.route_count}
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {destination.list_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableFrame>

            {total > pageSize && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of{" "}
                  {total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((currentPage) => currentPage + 1)}
                    disabled={(page + 1) * pageSize >= total}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </AdminPage>
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
    <th scope="col" className="px-4 py-3 font-medium text-muted">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 transition-colors hover:text-ink"
      >
        {label}
        <span className={`text-xs ${active ? "text-accent-text" : "text-faint"}`}>
          {active ? (sortDir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
        </span>
      </button>
    </th>
  );
}
