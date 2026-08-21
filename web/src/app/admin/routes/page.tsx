"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Input, Label } from "../../../components/ui/field";
import { StatCluster } from "../../../components/ui/stat";
import { Tabs } from "../../../components/ui/tabs";
import { getRoutes, getPendingRouteCount, type RouteRow } from "../../../lib/actions/routes";
import { LOADING_LABEL } from "../../../lib/constants";

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
  const [pendingCount, setPendingCount] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "pending">("active");
  const pageSize = 50;

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    const [result, pending] = await Promise.all([
      getRoutes(search, pageSize, page * pageSize, tab),
      getPendingRouteCount(),
    ]);
    setRoutes(result.routes);
    setTotal(result.total);
    setPendingCount(pending);
    setLoading(false);
  }, [search, page, tab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [result, pending] = await Promise.all([
        getRoutes(search, pageSize, page * pageSize, tab),
        getPendingRouteCount(),
      ]);
      if (!cancelled) {
        setRoutes(result.routes);
        setTotal(result.total);
        setPendingCount(pending);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [search, page, tab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchRoutes();
  };

  const handleTabChange = (newTab: "active" | "pending") => {
    setTab(newTab);
    setPage(0);
    setSearch("");
  };

  return (
    <AdminPage>
      <AdminPageHeader
        title="Routes"
        description="Review, import, and manage the route catalog."
        actions={
          <>
            <Button href="/admin/routes/import" variant="secondary">
              Import GPX
            </Button>
            <Button href="/admin/routes/new">Create route</Button>
          </>
        }
      />

      <div className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
        <StatCluster
          scale="topline"
          value={total.toLocaleString()}
          label={`${tab === "active" ? "Active" : "Pending"} routes`}
        />
        {tab === "active" ? (
          <StatCluster
            scale="topline"
            value={pendingCount.toLocaleString()}
            label="Pending review"
          />
        ) : null}
      </div>

      <section className="mt-10" aria-label="Route catalog">
        <Tabs
          items={[
            { value: "active", label: "Active" },
            {
              value: "pending",
              label: pendingCount > 0 ? `Pending review (${pendingCount})` : "Pending review",
            },
          ]}
          value={tab}
          onChange={(value) => handleTabChange(value as "active" | "pending")}
        />

        <form onSubmit={handleSearch} className="mt-6 max-w-md">
          <Label htmlFor="route-search">Search routes</Label>
          <Input
            id="route-search"
            type="text"
            placeholder="Search routes by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        {loading ? (
          <EmptyState className="mt-6">{LOADING_LABEL}</EmptyState>
        ) : routes.length === 0 ? (
          <EmptyState className="mt-6">
            {tab === "pending" ? "No routes pending review" : "No routes found"}
          </EmptyState>
        ) : (
          <>
            <AdminTableFrame className="mt-6">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface text-left text-xs text-muted">
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Distance</th>
                    <th scope="col" className="px-4 py-3 font-medium">Gain</th>
                    <th scope="col" className="px-4 py-3 font-medium">Destinations</th>
                    <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {tab === "pending" ? "Status" : "Completion"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr
                      key={route.id}
                      className="border-b border-hairline transition-colors last:border-b-0 hover:bg-fill"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/routes/${route.id}`}
                          className="font-medium text-accent-text hover:underline"
                        >
                          {route.name || "Unnamed Route"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {route.distance
                          ? `${(route.distance / 1609.34).toFixed(1)} mi`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {route.gain
                          ? `${Math.round(route.gain * 3.28084).toLocaleString()} ft`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num tabular-nums text-ink-2">
                        {route.destination_count}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={route.owner === "peaks" ? "sky" : "gray"}>
                          {route.owner === "peaks" ? "Peaks" : "User"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {tab === "pending" ? (
                          <Badge tone="amber">Pending</Badge>
                        ) : (
                          <span className="capitalize text-ink-2">
                            {route.completion}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableFrame>

            {total > pageSize && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  Showing <span className="font-mono-num tabular-nums">{page * pageSize + 1}</span>–
                  <span className="font-mono-num tabular-nums">
                    {Math.min((page + 1) * pageSize, total)}
                  </span>{" "}
                  of <span className="font-mono-num tabular-nums">{total}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
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
