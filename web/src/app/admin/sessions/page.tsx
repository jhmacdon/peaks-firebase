"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminGuard from "../../../components/admin-guard";
import AdminNav from "../../../components/admin-nav";
import UserPopover from "../../../components/user-popover";
import {
  getAdminSessions,
  type AdminSessionRow,
  type AdminSessionSort,
  type SortDir,
} from "../../../lib/actions/admin-sessions";

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
  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<AdminSessionSort>("start_time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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
    const result = await getAdminSessions(
      search,
      pageSize,
      page * pageSize,
      { field: sortField, dir: sortDir }
    );
    setSessions(result.sessions);
    setTotal(result.total);
    setLoading(false);
  }, [search, page, sortField, sortDir]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchSessions();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Sessions</h2>
            <p className="text-sm text-gray-500 mt-1">
              {total.toLocaleString()} total sessions
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by name or session ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </form>
        </div>

        {loading ? (
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-gray-500 py-12 text-center">
            No sessions found
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">
                      Session
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500">
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
                      label="High Point"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <th className="px-4 py-3 font-medium text-gray-500">
                      Points
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const date = new Date(s.start_time);
                    const displayName = deriveSessionName(
                      s.name,
                      s.destinationNames
                    );
                    return (
                      <tr
                        key={s.id}
                        className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/sessions/${s.id}`}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                          >
                            {displayName}
                          </Link>
                          {s.source && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {s.source}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <UserPopover uid={s.user_id} />
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {date.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {s.distance != null
                            ? `${(s.distance / 1609.34).toFixed(1)} mi`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {s.gain != null
                            ? `${Math.round(s.gain * 3.28084).toLocaleString()} ft`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {s.total_time != null
                            ? formatDuration(s.total_time)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {s.highest_point != null
                            ? `${Math.round(s.highest_point * 3.28084).toLocaleString()} ft`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {s.point_count.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
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
  field: AdminSessionSort;
  label: string;
  sortField: AdminSessionSort;
  sortDir: SortDir;
  onSort: (field: AdminSessionSort) => void;
}) {
  const active = sortField === field;
  return (
    <th className="px-4 py-3 font-medium text-gray-500">
      <button
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        {label}
        <span
          className={`text-xs ${active ? "text-blue-600 dark:text-blue-400" : "text-gray-300 dark:text-gray-600"}`}
        >
          {active ? (sortDir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
        </span>
      </button>
    </th>
  );
}
