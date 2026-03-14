"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";
import { getRoutes, type RouteRow } from "@/lib/actions/routes";

export default function RoutesPage() {
  return (
    <AdminGuard>
      <RoutesContent />
    </AdminGuard>
  );
}

function RoutesContent() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    const result = await getRoutes(search, pageSize, page * pageSize);
    setRoutes(result.routes);
    setTotal(result.total);
    setLoading(false);
  }, [search, page]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await getRoutes(search, pageSize, page * pageSize);
      if (!cancelled) {
        setRoutes(result.routes);
        setTotal(result.total);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [search, page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchRoutes();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Routes</h2>
            <p className="text-sm text-gray-500 mt-1">{total} total routes</p>
          </div>
          <Link
            href="/admin/routes/new"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Route
          </Link>
        </div>

        <form onSubmit={handleSearch} className="mb-6">
          <input
            type="text"
            placeholder="Search routes by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>

        {loading ? (
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        ) : routes.length === 0 ? (
          <div className="text-gray-500 py-12 text-center">No routes found</div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Name</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Distance</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Gain</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Destinations</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Owner</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr
                      key={route.id}
                      className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/routes/${route.id}`}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                        >
                          {route.name || "Unnamed Route"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {route.distance
                          ? `${(route.distance / 1609.34).toFixed(1)} mi`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {route.gain
                          ? `${Math.round(route.gain * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {route.destination_count}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            route.owner === "peaks"
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {route.owner === "peaks" ? "Peaks" : "User"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 capitalize">
                        {route.completion}
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
                  {Math.min((page + 1) * pageSize, total)} of {total}
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
