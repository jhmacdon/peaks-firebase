"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminGuard from "../../../../components/admin-guard";
import dynamic from "next/dynamic";
import {
  AdminPage,
  AdminPageHeader,
} from "../../../../components/admin/admin-page";
import { Breadcrumb } from "../../../../components/detail-sections";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Select } from "../../../../components/ui/field";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { StatCluster } from "../../../../components/ui/stat";
import { useAuth } from "../../../../lib/auth-context";
import {
  getRoute,
  getRouteDestinations,
  getRouteSegments,
  getRouteSessionCount,
  updateRoute,
  rejectRoute,
  analyzePendingRoute,
  acceptRouteWithSegments,
  type RouteDetail,
  type RouteDestination,
  type RouteSegment,
} from "../../../../lib/actions/routes";
import type { RouteDecomposition } from "../../../../lib/actions/segment-matcher";
import UserPopover from "../../../../components/user-popover";
import { LOADING_LABEL } from "../../../../lib/constants";

const RouteMap = dynamic(() => import("../../../../components/route-map"), { ssr: false });

export default function RouteDetailPage() {
  return (
    <AdminGuard>
      <RouteDetailContent />
    </AdminGuard>
  );
}

function RouteDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const { getIdToken } = useAuth();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCompletion, setEditCompletion] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewAction, setReviewAction] = useState<"analyzing" | "accepting" | "rejecting" | null>(null);
  const [decomposition, setDecomposition] = useState<RouteDecomposition | null>(null);

  useEffect(() => {
    async function load() {
      const [r, dests, segs, sessions] = await Promise.all([
        getRoute(id),
        getRouteDestinations(id),
        getRouteSegments(id),
        getRouteSessionCount(id),
      ]);
      setRoute(r);
      setDestinations(dests);
      setSegments(segs);
      setSessionCount(sessions);
      if (r) {
        setEditName(r.name || "");
        setEditCompletion(r.completion);

        // Auto-analyze pending routes
        if (r.status === "pending") {
          setReviewAction("analyzing");
          try {
            const result = await analyzePendingRoute(id);
            setDecomposition(result.decomposition);
          } catch (err) {
            console.error("Segment analysis failed:", err);
          }
          setReviewAction(null);
        }
      }
      setLoading(false);
    }
    load();
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    const token = await getIdToken();
    if (!token) {
      setSaving(false);
      return;
    }
    await updateRoute(token, id, { name: editName, completion: editCompletion });
    setRoute((prev) =>
      prev ? { ...prev, name: editName, completion: editCompletion } : prev
    );
    setEditing(false);
    setSaving(false);
  };

  const handleAccept = async () => {
    if (!decomposition) return;
    setReviewAction("accepting");
    const token = await getIdToken();
    if (!token) {
      setReviewAction(null);
      return;
    }
    // Server re-analyzes with full point data — client decomposition is just for preview
    await acceptRouteWithSegments(token, id);
    setRoute((prev) => prev ? { ...prev, status: "active" } : prev);
    setDecomposition(null);
    setReviewAction(null);
    const segs = await getRouteSegments(id);
    setSegments(segs);
  };

  const handleReject = async () => {
    if (!confirm("Delete this pending route? This cannot be undone.")) return;
    setReviewAction("rejecting");
    const token = await getIdToken();
    if (!token) {
      setReviewAction(null);
      return;
    }
    await rejectRoute(token, id);
    window.location.href = "/admin/routes";
  };

  if (loading) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">{LOADING_LABEL}</div>
      </AdminPage>
    );
  }

  if (!route) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">Route not found</div>
      </AdminPage>
    );
  }

  return (
    <AdminPage className="space-y-12">
      <AdminPageHeader
        breadcrumb={
          <Breadcrumb
            current={route.name || "Unnamed Route"}
            parentHref="/admin/routes"
            parentLabel="Routes"
          />
        }
        title={
          editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Route name"
              className="w-full max-w-xl border-b-2 border-accent bg-transparent pb-1 font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]"
              autoFocus
            />
          ) : (
            route.name || "Unnamed Route"
          )
        }
        description={<span className="font-mono-num text-xs text-faint">{route.id}</span>}
        actions={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />

      {route.status === "pending" && (
        <section className="rounded-media border border-border bg-surface p-5" aria-labelledby="pending-review">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge>Pending review</Badge>
              <h2 id="pending-review" className="mt-3 text-lg font-medium text-ink">
                Route review
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                {reviewAction === "analyzing"
                  ? "Analyzing segments..."
                  : decomposition
                    ? "Review the segment analysis below, then accept or reject."
                    : "Review the route details below."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={handleReject}
                disabled={reviewAction !== null}
              >
                {reviewAction === "rejecting" ? "Rejecting..." : "Reject"}
              </Button>
              <Button
                onClick={handleAccept}
                disabled={reviewAction !== null || !decomposition}
              >
                {reviewAction === "accepting"
                  ? "Accepting..."
                  : reviewAction === "analyzing"
                    ? "Analyzing..."
                    : "Accept Route"}
              </Button>
            </div>
          </div>

          {decomposition ? (
            <div className="mt-6">
              <SectionHeading level={3}>Segment analysis</SectionHeading>
              <ol className="mt-3 divide-y divide-hairline border-y border-hairline text-sm">
                  {decomposition.segments.map((seg, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 py-3"
                    >
                      <Badge>
                        {seg.type === "existing" ? "Reuse" : seg.type === "split" ? "Split" : "New"}
                      </Badge>
                      <span className="min-w-0 flex-1 text-ink-2">
                        {seg.existingSegmentName || seg.name || "Unnamed"}
                      </span>
                      <span className="shrink-0 font-mono-num tabular-nums text-muted">
                        {(seg.distance / 1609.34).toFixed(1)} mi
                      </span>
                    </li>
                  ))}
              </ol>
                {decomposition.splits.length > 0 && (
                  <p className="mt-3 text-xs text-alert">
                    {decomposition.splits.length} existing segment{decomposition.splits.length !== 1 ? "s" : ""} will be split.
                    {decomposition.affectedRoutes.length > 0 && (
                      <> {decomposition.affectedRoutes.length} other route{decomposition.affectedRoutes.length !== 1 ? "s" : ""} will be updated.</>
                    )}
                  </p>
                )}
                {decomposition.splits.length === 0 && decomposition.segments.some(s => s.type === "existing") && (
                  <p className="mt-3 text-xs text-success">
                    No splits needed — reuses existing segments cleanly.
                  </p>
                )}
            </div>
          ) : null}
        </section>
      )}

      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <StatCluster
          scale="topline"
          label="Distance"
          value={route.distance ? (route.distance / 1609.34).toFixed(1) : "—"}
          unit={route.distance ? "mi" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Elevation gain"
          value={route.gain ? Math.round(route.gain * 3.28084).toLocaleString() : "—"}
          unit={route.gain ? "ft" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Elevation loss"
          value={route.gain_loss ? Math.round(route.gain_loss * 3.28084).toLocaleString() : "—"}
          unit={route.gain_loss ? "ft" : undefined}
        />
        <StatCluster scale="topline" label="Sessions" value={sessionCount.toLocaleString()} />
      </div>

      {route.polyline6 && (
        <section aria-labelledby="route-map">
          <SectionHeading>
            <span id="route-map">Route map</span>
          </SectionHeading>
          <div className="mt-4 overflow-hidden rounded-media">
            <RouteMap polyline6={route.polyline6} />
          </div>
        </section>
      )}

      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <section aria-labelledby="route-details">
          <SectionHeading>
            <span id="route-details">Details</span>
          </SectionHeading>
          <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-sm">
              <DetailRow label="Owner">
                {route.owner === "peaks" ? (
                  <Badge>Peaks (system)</Badge>
                ) : (
                  <UserPopover uid={route.owner} />
                )}
              </DetailRow>
              <DetailRow label="Shape">
                <span className="capitalize">{route.shape?.replace(/_/g, " ") || "—"}</span>
              </DetailRow>
              <DetailRow label="Completion">
                {editing ? (
                  <Select
                    value={editCompletion}
                    onChange={(e) => setEditCompletion(e.target.value)}
                    className="h-8 max-w-40 py-0 text-xs"
                  >
                    <option value="none">None</option>
                    <option value="straight">Straight</option>
                    <option value="reverse">Reverse</option>
                  </Select>
                ) : (
                  <span className="capitalize">{route.completion}</span>
                )}
              </DetailRow>
              {route.elevation_string && (
                <DetailRow label="Elevation">{route.elevation_string}</DetailRow>
              )}
              {route.external_links && route.external_links.length > 0 && (
                <DetailRow label="External Links">
                  <div className="flex gap-2">
                    {route.external_links.map((link: { type: string; id: string }, i: number) => (
                      <Badge key={i}>
                        {link.type.toUpperCase()}: {link.id}
                      </Badge>
                    ))}
                  </div>
                </DetailRow>
              )}
              <DetailRow label="Created">
                {new Date(route.created_at).toLocaleDateString()}
              </DetailRow>
              <DetailRow label="Updated">
                {new Date(route.updated_at).toLocaleDateString()}
              </DetailRow>
              {route.polyline6 && (
                <DetailRow label="Polyline">
                  <span className="block max-w-xs truncate font-mono-num text-xs text-faint">
                    {route.polyline6.slice(0, 60)}...
                  </span>
                </DetailRow>
              )}
            </dl>
        </section>

        <section aria-labelledby="route-destinations">
          <SectionHeading>
            <span id="route-destinations">Destinations ({destinations.length})</span>
          </SectionHeading>
            {destinations.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No destinations linked</p>
            ) : (
              <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
                {destinations.map((dest) => (
                  <li key={dest.id}>
                    <Link
                      href={`/admin/destinations/${dest.id}`}
                      className="group flex items-center justify-between gap-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink group-hover:underline">
                          {dest.name || "Unknown"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {dest.elevation ? (
                            <span className="font-mono-num tabular-nums">
                              {Math.round(dest.elevation * 3.28084).toLocaleString()} ft
                            </span>
                          ) : null}
                          {Array.isArray(dest.features) && dest.features.length > 0
                            ? `${dest.elevation ? " · " : ""}${dest.features.join(", ")}`
                            : null}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono-num text-xs text-faint">
                        #{dest.ordinal}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
        </section>
      </div>

      {segments.length > 0 && (
        <section aria-labelledby="route-segments">
          <SectionHeading>
            <span id="route-segments">Segments ({segments.length})</span>
          </SectionHeading>
          <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
              {segments.map((seg) => (
                <li
                  key={`${seg.id}-${seg.ordinal}`}
                  className="flex flex-wrap items-center gap-4 py-3 sm:flex-nowrap"
                >
                  <span className="w-6 shrink-0 text-center font-mono-num text-xs text-faint">
                    {seg.ordinal}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">
                      {seg.name || "Unnamed Segment"}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono-num text-xs tabular-nums text-muted">
                      {seg.distance != null && (
                        <span>{(seg.distance / 1609.34).toFixed(1)} mi</span>
                      )}
                      {seg.gain != null && (
                        <span>{Math.round(seg.gain * 3.28084).toLocaleString()} ft gain</span>
                      )}
                      {seg.gain_loss != null && (
                        <span>{Math.round(seg.gain_loss * 3.28084).toLocaleString()} ft loss</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {seg.direction === "reverse" && (
                      <Badge>Reversed</Badge>
                    )}
                    {seg.route_count > 1 && (
                      <Badge>{seg.route_count} routes</Badge>
                    )}
                  </div>
                  <span className="shrink-0 font-mono-num text-xs text-faint" title={seg.id}>
                    {seg.id.slice(0, 8)}
                  </span>
                </li>
              ))}
          </ol>
        </section>
      )}
    </AdminPage>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}
