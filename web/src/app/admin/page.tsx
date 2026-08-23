"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "../../components/admin-guard";
import { AdminIcon } from "../../components/admin/admin-icons";
import { AdminPage, AdminPageHeader } from "../../components/admin/admin-page";
import { Button } from "../../components/ui/button";
import { SectionHeading } from "../../components/ui/section-heading";
import { StatCluster } from "../../components/ui/stat";
import { useAuth } from "../../lib/auth-context";
import { getAdminSessions } from "../../lib/actions/admin-sessions";
import { getDestinations } from "../../lib/actions/destinations";
import { getDestinationPhotoCandidates } from "../../lib/actions/destination-photos";
import { getRoutes } from "../../lib/actions/routes";
import type { AdminNavIcon } from "../../lib/admin-navigation";

type DashboardCounts = {
  photos: number | null;
  destinations: number | null;
  routes: number | null;
  sessions: number | null;
};

const EMPTY_COUNTS: DashboardCounts = {
  photos: null,
  destinations: null,
  routes: null,
  sessions: null,
};

const tools: Array<{
  title: string;
  description: string;
  href: string;
  icon: AdminNavIcon;
}> = [
  {
    title: "Photo review",
    description: "Approve licensed cover images and tune their framing.",
    href: "/admin/photos",
    icon: "photos",
  },
  {
    title: "Destinations",
    description: "Edit peaks, trailheads, boundaries, and catalog facts.",
    href: "/admin/destinations",
    icon: "destinations",
  },
  {
    title: "Routes",
    description: "Build routes, import sources, and inspect segment data.",
    href: "/admin/routes",
    icon: "routes",
  },
  {
    title: "Sessions",
    description: "Review recorded activity, tracks, and linked users.",
    href: "/admin/sessions",
    icon: "sessions",
  },
];

function countLabel(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString();
}

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <DashboardContent />
    </AdminGuard>
  );
}

function DashboardContent() {
  const { getIdToken, user } = useAuth();
  const [counts, setCounts] = useState<DashboardCounts>(EMPTY_COUNTS);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [countError, setCountError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      setLoadingCounts(true);
      setCountError(false);
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Missing admin token");
        const [destinations, routes, sessions, photos] = await Promise.allSettled([
          getDestinations("", 1, 0),
          getRoutes("", 1, 0),
          getAdminSessions(token, "", 1, 0),
          getDestinationPhotoCandidates(token, "pending", 0, 1),
        ]);
        if (!cancelled) {
          setCounts({
            photos: photos.status === "fulfilled" ? photos.value.total : null,
            destinations: destinations.status === "fulfilled" ? destinations.value.total : null,
            routes: routes.status === "fulfilled" ? routes.value.total : null,
            sessions: sessions.status === "fulfilled" ? sessions.value.total : null,
          });
          setCountError(
            [destinations, routes, sessions, photos].some(
              (result) => result.status === "rejected"
            )
          );
        }
      } catch {
        if (!cancelled) setCountError(true);
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    }

    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, user?.uid]);

  const countValue = (value: number | null) =>
    loadingCounts ? "···" : countLabel(value);

  return (
    <AdminPage>
      <AdminPageHeader
        title="Admin workspace"
        description="Keep the Peaks catalog accurate and useful for trip planning."
        actions={
          <Button href="/admin/destinations/new" variant="primary">
            <AdminIcon name="plus" size={16} />
            Add destination
          </Button>
        }
      />

      <section className="mt-12" aria-labelledby="admin-overview-heading">
        <SectionHeading eyebrow="Current" className="mb-7">
          <span id="admin-overview-heading">Catalog totals</span>
        </SectionHeading>
        <div className="flex flex-wrap gap-x-12 gap-y-7">
          <StatCluster value={countValue(counts.photos)} label="Photos awaiting review" scale="topline" />
          <StatCluster value={countValue(counts.destinations)} label="Destinations" scale="topline" />
          <StatCluster value={countValue(counts.routes)} label="Routes" scale="topline" />
          <StatCluster value={countValue(counts.sessions)} label="Sessions" scale="topline" />
        </div>
        {countError ? (
          <p className="mt-5 text-sm text-alert">Live counts could not be loaded. The admin tools are still available.</p>
        ) : null}
      </section>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section aria-labelledby="admin-tools-heading">
          <SectionHeading eyebrow="Manage" className="mb-5">
            <span id="admin-tools-heading">Workspace</span>
          </SectionHeading>
          <div className="overflow-hidden rounded-media border border-border bg-surface">
            <div className="divide-y divide-hairline">
              {tools.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className="group flex items-center gap-4 px-5 py-5 transition-colors hover:bg-fill sm:px-6"
                >
                  <AdminIcon name={tool.icon} size={20} className="shrink-0 text-muted group-hover:text-accent-text" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink group-hover:underline">{tool.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{tool.description}</span>
                  </span>
                  <AdminIcon name="arrow" size={16} className="shrink-0 text-faint transition-colors group-hover:text-ink-2" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="admin-shortcuts-heading">
          <SectionHeading eyebrow="Shortcuts" className="mb-5">
            <span id="admin-shortcuts-heading">Common tasks</span>
          </SectionHeading>
          <div className="flex flex-col items-stretch gap-2">
            <Button href="/admin/routes/new" variant="secondary" className="justify-start">
              Build a route
            </Button>
            <Button href="/admin/routes/import" variant="secondary" className="justify-start">
              Import routes
            </Button>
            <Button href="/admin/photos" variant="secondary" className="justify-start">
              Review photos
            </Button>
            <Button href="/" external variant="quiet" className="mt-2 justify-start">
              View the public site
              <AdminIcon name="external" size={15} />
            </Button>
          </div>
        </section>
      </div>
    </AdminPage>
  );
}
