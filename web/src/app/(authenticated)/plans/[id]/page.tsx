"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "../../../../lib/auth-context";
import {
  getPlanBundle,
  updatePlan,
  setPlanVisibility,
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
import { Input, Label, Textarea } from "../../../../components/ui/field";
import { EmptyState } from "../../../../components/ui/empty-state";
import { resolveShareUrl } from "../../../../components/share-link-utils";
import { publicSavedRoutePath } from "../../../../components/route-paths";
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
  const [editIsPublic, setEditIsPublic] = useState(false);
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

  // Share state
  const [confirmPublishToShare, setConfirmPublishToShare] = useState(false);
  const [readyToShare, setReadyToShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const plan = bundle?.plan ?? null;
  const isOwner = plan?.userId === user?.uid;

  // Memoized (not called inline in JSX) so DestinationPicker/RoutePicker's
  // own name-merge effects — which depend on this array by reference — only
  // re-run when the bundle's destinations/routes actually change, not on
  // every keystroke in a sibling field. Hooks must run unconditionally, so
  // this sits above the loading/error/not-found early returns below and
  // falls back to [] before the bundle has loaded.
  const editSelectedDestinations = useMemo(
    () => pickerNames(bundle?.destinations ?? []),
    [bundle?.destinations]
  );
  const editSelectedRoutes = useMemo(
    () => pickerNames(bundle?.routes ?? []),
    [bundle?.routes]
  );

  const loadBundle = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setLoadError("Sign in again to view this route.");
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
      setLoadError("Couldn’t load this route. Try again.");
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
    setEditIsPublic(plan.isPublic);
    setEditDestinations([...plan.destinations]);
    setEditRoutes([...plan.routes]);
    setSaveError(null);
    setConfirmPublishToShare(false);
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
        isPublic: editIsPublic,
      });

      setEditing(false);
      if (!editIsPublic) setReadyToShare(false);
      await loadBundle();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const sharePublicRoute = async (): Promise<"shared" | "copied"> => {
    if (!plan) throw new Error("Route not found");
    const url = resolveShareUrl(publicSavedRoutePath(planId));
    if (navigator.share) {
      await navigator.share({
        title: plan.name || "Shared route",
        text: `${plan.name || "A route"} on Peaks`,
        url,
      });
      return "shared";
    } else {
      await navigator.clipboard.writeText(url);
      setShareMessage("Route link copied");
      return "copied";
    }
  };

  const handleShare = async () => {
    if (!plan) return;
    setShareError(null);
    setShareMessage(null);
    if (!plan.isPublic) {
      if (isOwner) {
        setConfirmPublishToShare(true);
      } else {
        setShareError("Only the route owner can make this route public.");
      }
      return;
    }

    try {
      await sharePublicRoute();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setShareError("Couldn’t share this route.");
    }
  };

  const publishForSharing = async () => {
    if (!plan) return;
    setSharing(true);
    setShareError(null);
    setShareMessage(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to share this route.");
      await setPlanVisibility(token, planId, true);
      setBundle((current) =>
        current
          ? { ...current, plan: { ...current.plan, isPublic: true } }
          : current
      );
      setEditIsPublic(true);
      setConfirmPublishToShare(false);
      setReadyToShare(true);
    } catch (caught) {
      setShareError(
        caught instanceof Error ? caught.message : "Couldn’t share this route."
      );
    } finally {
      setSharing(false);
    }
  };

  const shareAfterPublishing = async () => {
    setShareError(null);
    try {
      const outcome = await sharePublicRoute();
      setReadyToShare(false);
      if (outcome === "shared") setShareMessage("Route shared");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setShareError("The route is public, but its link could not be shared.");
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
        setDeleteError("Sign in again to delete this route.");
        return;
      }
      await deletePlan(token, planId);
      router.push("/my-routes");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn’t delete this route. Try again.");
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
          title="Route not found"
          description="This route may have been removed, or you may not have access to it."
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
      <Breadcrumb current={plan.name || "Untitled Route"} parentHref="/my-routes" parentLabel="Routes" />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Route name"
              className="w-full border-b-2 border-accent bg-transparent font-display text-[28px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink focus:outline-none sm:text-[32px]"
            />
          ) : (
            <h1 className="font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]">
              {plan.name || "Untitled Route"}
            </h1>
          )}
          {!editing && (plan.date || isOwner) && (
            <p className="mt-2 text-sm text-ink-2">
              {[
                plan.date
                  ? `Trip Date: ${new Date(`${plan.date}T12:00:00`).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}`
                  : null,
                isOwner ? (plan.isPublic ? "Public route" : "Private route") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {editing && (
            <div className="mt-3 max-w-[220px]">
              <Label htmlFor="route-trip-date">Trip Date</Label>
              <Input
                id="route-trip-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!editing && (
            <Button variant="secondary" onClick={handleShare} disabled={sharing}>
              {sharing ? "Sharing…" : "Share"}
            </Button>
          )}
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

      {shareMessage ? (
        <p role="status" className="mt-3 text-sm font-medium text-success">
          {shareMessage}
        </p>
      ) : null}
      {shareError ? (
        <p role="alert" className="mt-3 text-sm text-alert">
          {shareError}
        </p>
      ) : null}

      {readyToShare ? (
        <div role="status" className="mt-4 rounded-media border border-success/40 bg-surface p-4">
          <p className="text-sm text-ink-2">
            The route is public. Tap below to open the share sheet or copy its link.
          </p>
          <Button className="mt-3" onClick={shareAfterPublishing}>
            Share public link
          </Button>
        </div>
      ) : null}

      {confirmPublishToShare && isOwner ? (
        <div
          role="alertdialog"
          aria-labelledby="publish-route-title"
          aria-describedby="publish-route-description"
          className="mt-4 rounded-media border border-border bg-surface p-4"
        >
          <p id="publish-route-title" className="text-sm font-medium text-ink">
            Make this route public and share it?
          </p>
          <p id="publish-route-description" className="mt-1 text-sm leading-6 text-ink-2">
            Anyone with the link can view the route details, destinations, and map, including any
            saved track. Photos and party details are not included.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={publishForSharing} disabled={sharing}>
              {sharing ? "Making public…" : "Make public"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmPublishToShare(false)}
              disabled={sharing}
            >
              Keep private
            </Button>
          </div>
        </div>
      ) : null}

      {/* Directly under the actions row, matching the destination/route
          pages' established order (hero/actions, then Topline, then the
          rest of the content) — before the description, not after it. */}
      {!editing && toplineStats.length > 0 && <Topline stats={toplineStats} className="mt-8" />}

      {editing ? (
        <div className="mt-6 space-y-4">
          <Textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={3}
            placeholder="Trip notes…"
            aria-label="Route description"
          />
          <label className="flex items-start gap-3 rounded-media border border-border p-4">
            <input
              type="checkbox"
              checked={editIsPublic}
              onChange={(event) => setEditIsPublic(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Public route</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">
                Anyone with the link can view the route details, destinations, and map, including
                any saved track. Photos and party details are not included.
              </span>
            </span>
          </label>
        </div>
      ) : plan.description ? (
        <p className="mt-6 max-w-[68ch] text-ink-2">{plan.description}</p>
      ) : null}

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
                selectedDestinations={editSelectedDestinations}
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
                selectedRoutes={editSelectedRoutes}
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
                  const content = (
                    <>
                      <span className={`font-medium text-ink ${route.isCatalog ? "group-hover:underline" : ""}`}>
                        {route.name || "Unnamed"}
                      </span>
                      {metaParts.length > 0 && (
                        <span className="shrink-0 text-xs text-muted">{metaParts.join(" · ")}</span>
                      )}
                    </>
                  );
                  return (
                    <li key={route.id}>
                      {route.isCatalog ? (
                        <Link
                          href={`/routes/${route.id}`}
                          className="group flex items-center justify-between gap-4 py-3"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between gap-4 py-3">
                          {content}
                        </div>
                      )}
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
                  Delete Route
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
