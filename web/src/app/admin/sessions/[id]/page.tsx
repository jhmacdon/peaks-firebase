"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AdminGuard from "../../../../components/admin-guard";
import UserPopover from "../../../../components/user-popover";
import {
  AdminPage,
  AdminPageHeader,
} from "../../../../components/admin/admin-page";
import { Breadcrumb } from "../../../../components/detail-sections";
import { Badge } from "../../../../components/ui/badge";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { StatCluster } from "../../../../components/ui/stat";
import { useAuth } from "../../../../lib/auth-context";
import { LOADING_LABEL } from "../../../../lib/constants";
import {
  getAdminSession,
  getAdminSessionPoints,
  getAdminSessionDestinations,
  type AdminSessionDetail,
  type AdminSessionPoint,
  type AdminSessionDestination,
} from "../../../../lib/actions/admin-sessions";

const SessionMap = dynamic(
  () => import("../../../../components/session-map"),
  { ssr: false }
);
const ElevationProfile = dynamic(
  () => import("../../../../components/elevation-profile"),
  { ssr: false }
);

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPace(metersPerSecond: number): string {
  const minPerMile = 1609.34 / metersPerSecond / 60;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

function buildDistances(points: AdminSessionPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const dlat = points[i].lat - points[i - 1].lat;
    const dlng = points[i].lng - points[i - 1].lng;
    const latRad = (points[i].lat * Math.PI) / 180;
    const dx = dlng * (Math.PI / 180) * 6371000 * Math.cos(latRad);
    const dy = dlat * (Math.PI / 180) * 6371000;
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return distances;
}

export default function AdminSessionDetailPage() {
  return (
    <AdminGuard>
      <SessionDetailContent />
    </AdminGuard>
  );
}

function SessionDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const { getIdToken } = useAuth();

  const [session, setSession] = useState<AdminSessionDetail | null>(null);
  const [points, setPoints] = useState<AdminSessionPoint[]>([]);
  const [destinations, setDestinations] = useState<AdminSessionDestination[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const [s, p, d] = await Promise.all([
        getAdminSession(token, id),
        getAdminSessionPoints(token, id),
        getAdminSessionDestinations(token, id),
      ]);
      setSession(s);
      setPoints(p);
      setDestinations(d);
      setLoading(false);
    }
    load();
  }, [getIdToken, id]);

  if (loading) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">{LOADING_LABEL}</div>
      </AdminPage>
    );
  }

  if (!session) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">Session not found</div>
      </AdminPage>
    );
  }

  const date = new Date(session.start_time);
  const displayName =
    session.name ||
    (destinations.length > 0
      ? destinations
          .filter((d) => d.name)
          .map((d) => d.name)
          .join(", ") || "Untitled Session"
      : "Untitled Session");

  const distances = buildDistances(points);
  const elevationPoints = points
    .flatMap((p, i) => p.elevation == null
      ? []
      : [{ dist: distances[i], ele: p.elevation }]);

  return (
    <AdminPage className="space-y-12">
      <AdminPageHeader
        breadcrumb={
          <Breadcrumb
            current={displayName}
            parentHref="/admin/sessions"
            parentLabel="Sessions"
          />
        }
        title={displayName}
        description={
          <span>
            {date.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {" · "}
            <span className="font-mono-num text-xs text-faint">{session.id}</span>
          </span>
        }
        actions={
          <>
            <UserPopover uid={session.user_id} />
            {session.source ? <Badge>{session.source}</Badge> : null}
            {session.processing_state ? (
              <Badge tone={session.processing_state === "failed" ? "red" : "gray"}>
                {session.processing_state}
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <StatCluster
          scale="topline"
          label="Distance"
          value={session.distance != null ? (session.distance / 1609.34).toFixed(1) : "—"}
          unit={session.distance != null ? "mi" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Elevation gain"
          value={session.gain != null ? Math.round(session.gain * 3.28084).toLocaleString() : "—"}
          unit={session.gain != null ? "ft" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Time"
          value={session.total_time != null ? formatDuration(session.total_time) : "—"}
        />
        <StatCluster
          scale="topline"
          label="Highest point"
          value={
            session.highest_point != null
              ? Math.round(session.highest_point * 3.28084).toLocaleString()
              : "—"
          }
          unit={session.highest_point != null ? "ft" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Pace"
          value={session.pace != null && session.pace > 0 ? formatPace(session.pace) : "—"}
        />
      </div>

      {points.length > 0 && (
        <section aria-labelledby="session-track">
          <div className="flex items-baseline justify-between gap-4">
            <SectionHeading>
              <span id="session-track">GPS track</span>
            </SectionHeading>
            <span className="font-mono-num text-xs tabular-nums text-faint">
              {points.length.toLocaleString()} points
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded-media">
            <SessionMap points={points} />
          </div>
        </section>
      )}

      {elevationPoints.length >= 2 && (
        <section aria-labelledby="session-elevation">
          <SectionHeading>
            <span id="session-elevation">Elevation profile</span>
          </SectionHeading>
          <div className="mt-4 overflow-hidden rounded-media">
            <ElevationProfile points={elevationPoints} />
          </div>
        </section>
      )}

      <section aria-labelledby="session-destinations">
        <SectionHeading>
          <span id="session-destinations">Destinations ({destinations.length})</span>
        </SectionHeading>
          {destinations.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No destinations matched</p>
          ) : (
            <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
              {destinations.map((dest) => (
                <li key={dest.id}>
                  <Link
                    href={`/admin/destinations/${dest.id}`}
                    className="group flex flex-wrap items-center justify-between gap-3 py-3 sm:flex-nowrap"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink group-hover:underline">
                        {dest.name || "Unnamed"}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {dest.elevation != null ? (
                          <span className="font-mono-num tabular-nums">
                            {Math.round(dest.elevation * 3.28084).toLocaleString()} ft
                          </span>
                        ) : null}
                        {dest.features.length > 0
                          ? `${dest.elevation != null ? " · " : ""}${dest.features.join(", ")}`
                          : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge>{dest.source}</Badge>
                      <span className="text-xs capitalize text-faint">{dest.relation}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="session-metadata">
        <SectionHeading>
          <span id="session-metadata">Metadata</span>
        </SectionHeading>
          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 text-sm sm:grid-cols-3">
            {session.ascent_time != null && (
              <div>
                <dt className="text-xs text-muted">Ascent time</dt>
                <dd className="mt-1 font-mono-num text-ink-2">{formatDuration(session.ascent_time)}</dd>
              </div>
            )}
            {session.descent_time != null && (
              <div>
                <dt className="text-xs text-muted">Descent time</dt>
                <dd className="mt-1 font-mono-num text-ink-2">{formatDuration(session.descent_time)}</dd>
              </div>
            )}
            {session.still_time != null && (
              <div>
                <dt className="text-xs text-muted">Still time</dt>
                <dd className="mt-1 font-mono-num text-ink-2">{formatDuration(session.still_time)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">Public</dt>
              <dd className="mt-1 text-ink-2">{session.is_public ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Ended</dt>
              <dd className="mt-1 text-ink-2">{session.ended ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Created</dt>
              <dd className="mt-1 text-ink-2">{new Date(session.created_at).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Updated</dt>
              <dd className="mt-1 text-ink-2">{new Date(session.updated_at).toLocaleDateString()}</dd>
            </div>
          </dl>
      </section>
    </AdminPage>
  );
}
