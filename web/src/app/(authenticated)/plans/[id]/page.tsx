"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "../../../../lib/auth-context";
import {
  getPlanBundle,
  updatePlan,
  deletePlan,
  inviteToPlan,
  type PlanBundle,
} from "../../../../lib/actions/plans";
import { getPlanAirQuality, type PlanAirQuality } from "../../../../lib/actions/air-quality";
import {
  buildPlanMapMarkers,
  buildPlanMapRoutes,
  buildPlanTopline,
  pickerNames,
} from "../../../../lib/plan-detail";
import { formatFeet, formatMiles } from "../../../../lib/destination-detail";
import PartyList from "../../../../components/party-list";
import DestinationPicker from "../../../../components/destination-picker";
import RoutePicker from "../../../../components/route-picker";
import PlanAirQualityCard from "../../../../components/plan-air-quality-card";
import { Breadcrumb } from "../../../../components/detail-sections";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { Topline } from "../../../../components/ui/topline";
import { Button } from "../../../../components/ui/button";
import { Input, Textarea } from "../../../../components/ui/field";
import { EmptyState } from "../../../../components/ui/empty-state";
import { LOADING_LABEL } from "../../../../lib/constants";

const PlanMap = dynamic(() => import("../../../../components/plan-map"), {
  ssr: false,
});

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;
  const router = useRouter();
  const { user, getIdToken } = useAuth();

  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [airQuality, setAirQuality] = useState<PlanAirQuality | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDestinations, setEditDestinations] = useState<string[]>([]);
  const [editRoutes, setEditRoutes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Invite state
  const [inviteUid, setInviteUid] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const plan = bundle?.plan ?? null;
  const isOwner = plan?.userId === user?.uid;

  const loadBundle = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setLoadError("Sign in again to view this plan.");
        return;
      }

      const data = await getPlanBundle(token, planId);
      setBundle(data);

      if (data) {
        // Best-effort: the plan page must never break because the smoke feed
        // hiccuped (docs/superpowers/specs/2026-08-06-plan-air-quality-design.md).
        getPlanAirQuality(token, planId).then(setAirQuality).catch(() => {});
      }
    } catch {
      setLoadError("Couldn’t load this plan. Try again.");
    } finally {
      setLoading(false);
    }
  }, [getIdToken, planId]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  const startEditing = () => {
    if (!plan) return;
    setEditName(plan.name);
    setEditDescription(plan.description);
    setEditDate(plan.date || "");
    setEditDestinations([...plan.destinations]);
    setEditRoutes([...plan.routes]);
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveChanges = async () => {
    if (!plan) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setSaveError("Sign in again to save changes.");
        return;
      }

      await updatePlan(token, planId, {
        name: editName.trim(),
        description: editDescription.trim(),
        destinations: editDestinations,
        routes: editRoutes,
        date: editDate || undefined,
      });

      setEditing(false);
      await loadBundle();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteUid.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setInviteError("Sign in again to invite someone.");
        return;
      }
      await inviteToPlan(token, planId, inviteUid.trim());
      setInviteUid("");
      await loadBundle();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn’t send that invite. Try again.");
    } finally {
      setInviting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setDeleteError("Sign in again to delete this plan.");
        return;
      }
      await deletePlan(token, planId);
      router.push("/plans");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn’t delete this plan. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="py-12 text-center text-muted">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <p role="alert" className="py-8 text-center text-sm text-alert">
          {loadError}
        </p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadBundle}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!bundle || !plan) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <EmptyState
          title="Plan not found"
          description="This plan may have been removed, or you may not have access to it."
        />
      </div>
    );
  }

  const toplineStats = buildPlanTopline(bundle.processing);
  const mapRoutes = buildPlanMapRoutes(bundle.routes);
  const mapMarkers = buildPlanMapMarkers(bundle.destinations, bundle.reachedDestinations);
  const planPath = bundle.processing?.path ?? null;
  const hasMapContent = mapRoutes.length > 0 || mapMarkers.length > 0 || Boolean(planPath);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <Breadcrumb current={plan.name || "Untitled Plan"} parentHref="/plans" parentLabel="Plans" />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Plan name"
              className="w-full border-b-2 border-accent bg-transparent font-display text-[28px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink focus:outline-none sm:text-[32px]"
            />
          ) : (
            <h1 className="font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]">
              {plan.name || "Untitled Plan"}
            </h1>
          )}
          {!editing && plan.date && (
            <p className="mt-2 text-sm text-ink-2">
              {new Date(plan.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          {editing && (
            <Input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              aria-label="Plan date"
              className="mt-3 max-w-[220px]"
            />
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {isOwner && !editing && (
            <Button variant="secondary" onClick={startEditing}>
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button onClick={saveChanges} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && saveError && (
        <p role="alert" className="mt-3 text-sm text-alert">
          {saveError}
        </p>
      )}

      {editing ? (
        <Textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          rows={3}
          placeholder="Trip notes…"
          aria-label="Plan description"
          className="mt-6"
        />
      ) : plan.description ? (
        <p className="mt-6 max-w-[68ch] text-ink-2">{plan.description}</p>
      ) : null}

      {!editing && toplineStats.length > 0 && <Topline stats={toplineStats} className="mt-8" />}

      {!editing && hasMapContent && (
        <section className="mt-8" aria-labelledby="plan-map-heading">
          <SectionHeading>
            <span id="plan-map-heading">Map</span>
          </SectionHeading>
          <div className="isolate mt-4 overflow-hidden rounded-media">
            <PlanMap
              routes={mapRoutes}
              destinations={mapMarkers}
              path={planPath}
              className="h-[320px] sm:h-[420px]"
            />
          </div>
        </section>
      )}

      {!editing && airQuality && (
        <div className="mt-8">
          <PlanAirQualityCard aq={airQuality} />
        </div>
      )}

      {!editing && bundle.reachedDestinations.length > 0 && (
        <section
          className="mt-8 rounded-media border border-border bg-surface p-6"
          aria-labelledby="plan-reached-heading"
        >
          <SectionHeading>
            <span id="plan-reached-heading">
              Reached along the way ({bundle.reachedDestinations.length})
            </span>
          </SectionHeading>
          <ol className="mt-4 divide-y divide-hairline">
            {bundle.reachedDestinations.map((dest) => (
              <li key={dest.id} className="flex items-center justify-between gap-4 py-3">
                <Link href={`/destinations/${dest.id}`} className="font-medium text-ink hover:underline">
                  {dest.name || "Unnamed"}
                </Link>
                {dest.elevation != null && (
                  <span className="shrink-0 text-xs text-muted">{formatFeet(dest.elevation)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Destinations */}
        <div className="rounded-media border border-border bg-surface p-6" aria-labelledby="plan-destinations-heading">
          <SectionHeading>
            <span id="plan-destinations-heading">Destinations ({bundle.destinations.length})</span>
          </SectionHeading>
          <div className="mt-4">
            {editing ? (
              <DestinationPicker
                selectedIds={editDestinations}
                selectedDestinations={pickerNames(bundle.destinations)}
                onChange={setEditDestinations}
              />
            ) : bundle.destinations.length === 0 ? (
              <p className="text-sm text-muted">No destinations added</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {bundle.destinations.map((dest) => (
                  <li key={dest.id}>
                    <Link
                      href={`/destinations/${dest.id}`}
                      className="group flex items-center justify-between gap-4 py-3"
                    >
                      <span className="font-medium text-ink group-hover:underline">
                        {dest.name || "Unnamed"}
                      </span>
                      {dest.elevation != null && (
                        <span className="shrink-0 text-xs text-muted">{formatFeet(dest.elevation)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Routes */}
        <div className="rounded-media border border-border bg-surface p-6" aria-labelledby="plan-routes-heading">
          <SectionHeading>
            <span id="plan-routes-heading">Routes ({bundle.routes.length})</span>
          </SectionHeading>
          <div className="mt-4">
            {editing ? (
              <RoutePicker
                selectedIds={editRoutes}
                selectedRoutes={pickerNames(bundle.routes)}
                onChange={setEditRoutes}
              />
            ) : bundle.routes.length === 0 ? (
              <p className="text-sm text-muted">No routes added</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {bundle.routes.map((route) => {
                  const metaParts = [
                    route.distance != null ? formatMiles(route.distance) : null,
                    route.gain != null ? `${formatFeet(route.gain)} gain` : null,
                  ].filter((part): part is string => Boolean(part));
                  return (
                    <li key={route.id}>
                      <Link
                        href={`/routes/${route.id}`}
                        className="group flex items-center justify-between gap-4 py-3"
                      >
                        <span className="font-medium text-ink group-hover:underline">
                          {route.name || "Unnamed"}
                        </span>
                        {metaParts.length > 0 && (
                          <span className="shrink-0 text-xs text-muted">{metaParts.join(" · ")}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Party */}
        <div className="rounded-media border border-border bg-surface p-6" aria-labelledby="plan-party-heading">
          <SectionHeading>
            <span id="plan-party-heading">Party ({plan.party.length + 1})</span>
          </SectionHeading>

          <div className="mt-4">
            {/* Owner */}
            <div className="mb-3 rounded-ctl bg-fill p-3">
              <p className="text-sm font-medium text-ink">
                {user?.displayName || user?.email || "You"}{" "}
                <span className="text-xs text-muted">(owner)</span>
              </p>
            </div>

            <PartyList partyIds={plan.party} />

            {/* Invite */}
            {isOwner && (
              <div className="mt-4 flex gap-2">
                <Input
                  type="text"
                  value={inviteUid}
                  onChange={(e) => setInviteUid(e.target.value)}
                  placeholder="User ID to invite"
                  className="flex-1"
                />
                <Button onClick={handleInvite} disabled={inviting || !inviteUid.trim()}>
                  {inviting ? "…" : "Invite"}
                </Button>
              </div>
            )}
            {inviteError && (
              <p role="alert" className="mt-2 text-sm text-alert">
                {inviteError}
              </p>
            )}
          </div>
        </div>

        {/* Danger Zone */}
        {isOwner && !editing && (
          <div
            className="rounded-media border border-alert/30 bg-surface p-6"
            aria-labelledby="plan-danger-heading"
          >
            <h2 id="plan-danger-heading" className="text-lg font-medium text-alert">
              Danger Zone
            </h2>
            <div className="mt-4">
              {!confirmDelete ? (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete Plan
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">Are you sure? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                      {deleting ? "Deleting…" : "Yes, Delete"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setConfirmDelete(false);
                        setDeleteError(null);
                      }}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {deleteError && (
                <p role="alert" className="mt-4 text-sm text-alert">
                  {deleteError}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
