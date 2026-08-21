"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import AdminGuard from "../../../components/admin-guard";
import {
  AdminPage,
  AdminPageHeader,
  AdminTableFrame,
} from "../../../components/admin/admin-page";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Input } from "../../../components/ui/field";
import { StatCluster } from "../../../components/ui/stat";
import UserPopover from "../../../components/user-popover";
import { useAuth } from "../../../lib/auth-context";
import {
  getAdminSessions,
  type AdminSessionRow,
  type AdminSessionSort,
  type SortDir,
} from "../../../lib/actions/admin-sessions";
import { getDestination } from "../../../lib/actions/destinations";
import { LOADING_LABEL } from "../../../lib/constants";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function deriveSessionName(
  name: string | null,
  destinationNames: string[]
): string {
  if (name) return name;
  if (destinationNames.length > 0) return destinationNames.join(", ");
  return "Untitled Session";
}

export default function AdminSessionsPage() {
  return (
    <AdminGuard>
      <SessionsContent />
    </AdminGuard>
  );
}

function SessionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getIdToken } = useAuth();
  const destinationId = searchParams.get("destination") || "";

  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<AdminSessionSort>("start_time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [destinationName, setDestinationName] = useState<string | null>(null);
  const pageSize = 50;

  const toggleSort = (field: AdminSessionSort) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "start_time" ? "desc" : "desc");
    }
    setPage(0);
  };

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const token = await getIdToken();
    if (!token) return;
    const result = await getAdminSessions(
      token,
      search,
      pageSize,
      page * pageSize,
      { field: sortField, dir: sortDir },
      destinationId ? { destination_id: destinationId } : undefined
    );
    setSessions(result.sessions);
    setTotal(result.total);
    setLoading(false);
  }, [getIdToken, search, page, sortField, sortDir, destinationId]);

  useEffect(() => {
    if (!destinationId) {
      setDestinationName(null);
      return;
    }
    let cancelled = false;
    getDestination(destinationId).then((d) => {
      if (!cancelled) setDestinationName(d?.name || "Unnamed");
    });
    return () => {
      cancelled = true;
    };
  }, [destinationId]);

  useEffect(() => {
    setPage(0);
  }, [destinationId]);

  const clearDestinationFilter = () => {
    router.push("/admin/sessions");
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchSessions();
  };

  return (
    <AdminPage className="space-y-10">
      <AdminPageHeader
        title="Sessions"
        description="Review tracked activities, their owners, and the stored data for each recording."
      />

      <StatCluster value={total.toLocaleString()} label="Sessions" scale="topline" />

      <section className="space-y-5" aria-label="Session filters and results">
        {destinationId && (
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-fill px-3 py-1.5 text-sm text-ink-2">
            <span className="text-xs text-muted">Destination</span>
            <Link
              href={`/admin/destinations/${destinationId}`}
              className="truncate font-medium text-accent-text hover:underline"
            >
              {destinationName || LOADING_LABEL}
            </Link>
            <button
              type="button"
              onClick={clearDestinationFilter}
              className="ml-1 text-faint transition-colors hover:text-alert"
              aria-label="Clear destination filter"
            >
              &times;
            </button>
          </div>
        )}

        <form onSubmit={handleSearch} className="min-w-0">
          <Input
            type="search"
            aria-label="Search sessions"
            placeholder="Search by name or session ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </form>

        {loading ? (
          <div className="py-14 text-center text-sm text-muted">{LOADING_LABEL}</div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions found"
            description="Try a broader search or clear the destination filter."
          />
        ) : (
          <>
            <AdminTableFrame>
              <table className="min-w-[1040px] w-full text-sm">
                <thead className="bg-surface">
                  <tr className="border-b border-hairline text-left">
                    <th scope="col" className="px-4 py-3 font-medium text-muted">
                      Session
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">
                      User
                    </th>
                    <SortHeader
                      field="start_time"
                      label="Date"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      field="distance"
                      label="Distance"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      field="gain"
                      label="Gain"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      field="total_time"
                      label="Time"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      field="highest_point"
                      label="High point"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <th scope="col" className="px-4 py-3 font-medium text-muted">
                      Points
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const date = new Date(session.start_time);
                    const displayName = deriveSessionName(
                      session.name,
                      session.destinationNames
                    );
                    return (
                      <tr
                        key={session.id}
                        className="border-b border-hairline transition-colors last:border-b-0 hover:bg-surface"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/sessions/${session.id}`}
                            className="font-medium text-accent-text hover:underline"
                          >
                            {displayName}
                          </Link>
                          {session.source && (
                            <div className="mt-0.5 text-xs text-faint">
                              {session.source}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <UserPopover uid={session.user_id} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                          {date.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono-num tabular-nums text-ink-2">
                          {session.distance != null
                            ? `${(session.distance / 1609.34).toFixed(1)} mi`
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono-num tabular-nums text-ink-2">
                          {session.gain != null
                            ? `${Math.round(session.gain * 3.28084).toLocaleString()} ft`
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono-num tabular-nums text-ink-2">
                          {session.total_time != null
                            ? formatDuration(session.total_time)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono-num tabular-nums text-ink-2">
                          {session.highest_point != null
                            ? `${Math.round(session.highest_point * 3.28084).toLocaleString()} ft`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                          {session.point_count.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
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
  field: AdminSessionSort;
  label: string;
  sortField: AdminSessionSort;
  sortDir: SortDir;
  onSort: (field: AdminSessionSort) => void;
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
