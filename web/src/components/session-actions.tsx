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

function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "peaks-activity";
}

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = user?.uid === session.user_id;

  useEffect(() => {
    setName(session.name ?? "");
    setActivityType(session.activity_type ?? "");
    setIsPublic(session.is_public);
    setEditing(false);
    setConfirmDelete(false);
    setMessage(null);
    setError(null);
  }, [session.id, session.name, session.activity_type, session.is_public]);

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

  async function share() {
    setError(null);
    setMessage(null);
    if (!session.is_public) {
      setError("Make this activity public before sharing its link.");
      return;
    }
    const shareData = {
      title: displayName,
      text: `${displayName} on Peaks`,
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setMessage("Activity link copied");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Could not share this activity");
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
    <div className={`space-y-3 ${editing ? "w-full" : ""}`}>
      <div className="flex flex-wrap gap-2">
        {isOwner && (
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setConfirmDelete(false);
              setError(null);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {editing ? "Close editor" : "Edit"}
          </button>
        )}
        {user && (
          <button
            type="button"
            onClick={exportGpx}
            disabled={exporting}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {exporting ? "Preparing GPX…" : "Export GPX"}
          </button>
        )}
        <button
          type="button"
          onClick={share}
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Share
        </button>
      </div>

      {message && (
        <p
          role="status"
          className="text-sm font-medium text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {editing && isOwner && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Activity name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="Use reached peaks when blank"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-medium">
                Activity type
              </span>
              <select
                value={activityType}
                onChange={(event) =>
                  setActivityType(event.target.value as SessionActivityType | "")
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">Outdoor activity</option>
                <option value="outdoor-trek">Hike</option>
                <option value="ski">Ski</option>
                <option value="outdoor-moto">Moto</option>
              </select>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              <span>
                <span className="block text-sm font-medium">Public activity</span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  Anyone with this link can view the activity and track.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Cancel
              </button>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete activity
            </button>
          </div>

          {confirmDelete && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <p className="text-sm font-medium text-red-900 dark:text-red-200">
                Delete this activity and all of its GPS points? This cannot be
                undone.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-800 dark:text-red-200"
                >
                  Keep activity
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
