"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deleteSession,
  getSessionPointsForExport,
  updateSessionMetadata,
  type SessionActivityType,
  type SessionDetail,
  type SessionMetadataUpdate,
  type SessionPoint,
} from "../lib/actions/sessions";
import { useAuth } from "../lib/auth-context";
import { buildSessionGpx } from "../lib/session-track";
import { Button } from "./ui/button";
import { Input, Label, Select } from "./ui/field";
import { SectionHeading } from "./ui/section-heading";
import { resolveShareUrl } from "./share-link-utils";

function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "peaks-activity";
}

/** The owner's tools, in one quiet row at the foot of the activity page
 * (audit §2b puts them beside the title; a page whose whole job is reading
 * an activity is better served with the editing tools last).
 *
 * Neutral `secondary` fills rather than the `quiet` accent-text variant:
 * three accent labels in a row would spend the whole accent budget on
 * chrome (design-tokens.md, "Accent budget"). The page's one filled primary
 * is Save, and it only exists while the editor is open. Delete keeps its
 * two-step confirm.
 */
export default function SessionActions({
  session,
  displayName,
  onUpdated,
}: {
  session: SessionDetail;
  displayName: string;
  onUpdated: (updates: SessionMetadataUpdate) => void;
}) {
  const router = useRouter();
  const { user, getIdToken } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session.name ?? "");
  const [activityType, setActivityType] = useState<
    SessionActivityType | ""
  >(session.activity_type ?? "");
  const [isPublic, setIsPublic] = useState(session.is_public);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPublishToShare, setConfirmPublishToShare] = useState(false);
  const [readyToShare, setReadyToShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = user?.uid === session.user_id;

  useEffect(() => {
    setName(session.name ?? "");
    setActivityType(session.activity_type ?? "");
    setIsPublic(session.is_public);
  }, [session.name, session.activity_type, session.is_public]);

  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setConfirmPublishToShare(false);
    setReadyToShare(false);
    setMessage(null);
    setError(null);
  }, [session.id]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to save this activity");
      const updates: SessionMetadataUpdate = {
        name: name.trim() || null,
        activity_type: activityType || null,
        is_public: isPublic,
      };
      await updateSessionMetadata(token, session.id, updates);
      onUpdated(updates);
      setEditing(false);
      if (!updates.is_public) setReadyToShare(false);
      setMessage("Activity updated");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update activity"
      );
    } finally {
      setSaving(false);
    }
  }

  async function exportGpx() {
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to export this activity");
      const points: SessionPoint[] = [];
      let afterTime: number | null = null;

      for (;;) {
        const page = await getSessionPointsForExport(
          token,
          session.id,
          afterTime
        );
        points.push(...page.points);
        if (!page.hasMore) break;

        const nextCursor = page.points[page.points.length - 1]?.time;
        if (nextCursor == null || nextCursor === afterTime) {
          throw new Error("Could not continue the GPX export");
        }
        afterTime = nextCursor;
      }

      if (points.length === 0) {
        throw new Error("This activity has no GPS points to export");
      }

      const blob = new Blob([buildSessionGpx(displayName, points)], {
        type: "application/gpx+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(displayName)}.gpx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage(`Exported ${points.length.toLocaleString("en-US")} GPS points`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not export GPX"
      );
    } finally {
      setExporting(false);
    }
  }

  async function sharePublicLink(): Promise<"shared" | "copied"> {
    const url = resolveShareUrl(`/log/${encodeURIComponent(session.id)}`);
    const shareData = {
      title: displayName,
      text: `${displayName} on Peaks`,
      url,
    };

    if (navigator.share) {
      await navigator.share(shareData);
      return "shared";
    } else {
      await navigator.clipboard.writeText(url);
      setMessage("Activity link copied");
      return "copied";
    }
  }

  async function share() {
    setError(null);
    setMessage(null);
    if (!session.is_public) {
      if (isOwner) {
        setConfirmPublishToShare(true);
      } else {
        setError("This activity is private.");
      }
      return;
    }

    try {
      await sharePublicLink();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Could not share this activity");
    }
  }

  async function publishForSharing() {
    setSharing(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to share this activity");
      const updates: SessionMetadataUpdate = {
        name: session.name,
        activity_type: session.activity_type,
        is_public: true,
      };
      await updateSessionMetadata(token, session.id, updates);
      onUpdated(updates);
      setIsPublic(true);
      setConfirmPublishToShare(false);
      setReadyToShare(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not share this activity"
      );
    } finally {
      setSharing(false);
    }
  }

  async function shareAfterPublishing() {
    setError(null);
    try {
      const outcome = await sharePublicLink();
      setReadyToShare(false);
      if (outcome === "shared") setMessage("Activity shared");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("The activity is public, but its link could not be shared.");
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to delete this activity");
      await deleteSession(token, session.id);
      router.push("/log");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete activity"
      );
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="session-tools">
      <SectionHeading>
        <span id="session-tools">Activity tools</span>
      </SectionHeading>

      <div className="flex flex-wrap gap-2">
        {isOwner && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing((value) => !value);
              setConfirmDelete(false);
              setConfirmPublishToShare(false);
              setError(null);
            }}
          >
            {editing ? "Close editor" : "Edit"}
          </Button>
        )}
        {user && (
          <Button variant="secondary" onClick={exportGpx} disabled={exporting}>
            {exporting ? "Preparing GPX…" : "Export GPX"}
          </Button>
        )}
        <Button variant="secondary" onClick={share} disabled={sharing}>
          {sharing ? "Sharing…" : "Share"}
        </Button>
        {isOwner && (
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDelete(true);
              setConfirmPublishToShare(false);
              setMessage(null);
              setError(null);
            }}
          >
            Delete
          </Button>
        )}
      </div>

      {message && (
        <p role="status" className="text-sm font-medium text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}

      {readyToShare && (
        <div role="status" className="rounded-media border border-success/40 bg-surface p-4">
          <p className="text-sm text-ink-2">
            The activity is public. Tap below to open the share sheet or copy its link.
          </p>
          <Button className="mt-3" onClick={shareAfterPublishing}>
            Share public link
          </Button>
        </div>
      )}

      {confirmPublishToShare && isOwner && (
        <div
          role="alertdialog"
          aria-labelledby="publish-activity-title"
          aria-describedby="publish-activity-description"
          className="rounded-media border border-border bg-surface p-4"
        >
          <p id="publish-activity-title" className="text-sm font-medium text-ink">
            Make this activity public and share it?
          </p>
          <p id="publish-activity-description" className="mt-1 text-sm leading-6 text-ink-2">
            Anyone with the link can view the exact GPS track, activity time and timing details,
            plus derived pace or speed where shown. Photos and health data are not included.
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
      )}

      {confirmDelete && isOwner && (
        <div className="rounded-media border border-alert/40 p-4">
          <p className="text-sm font-medium text-ink">
            Delete this activity and all of its GPS points? This cannot be
            undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep activity
            </Button>
          </div>
        </div>
      )}

      {editing && isOwner && (
        <div className="rounded-media border border-border p-4 sm:p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="session-name">Activity name</Label>
              <Input
                id="session-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="Use reached peaks when blank"
              />
            </div>

            <div>
              <Label htmlFor="session-activity-type">Activity type</Label>
              <Select
                id="session-activity-type"
                value={activityType}
                onChange={(event) =>
                  setActivityType(event.target.value as SessionActivityType | "")
                }
              >
                <option value="">Outdoor activity</option>
                <option value="outdoor-trek">Hike</option>
                <option value="ski">Ski</option>
                <option value="outdoor-moto">Moto</option>
              </Select>
            </div>

            <label className="flex items-start gap-3 self-end pb-1">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  Public activity
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  Anyone with the link can view the exact GPS track, activity time and timing
                  details, plus derived pace or speed where shown. Photos and health data are not
                  included.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
