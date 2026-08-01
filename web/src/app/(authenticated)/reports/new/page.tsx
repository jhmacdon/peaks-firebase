"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth-context";
import {
  createTripReport,
  getTripReportEligibleSessions,
  type TripReportEligibleSession,
} from "../../../../lib/actions/trip-reports";

export default function NewReportPage() {
  const router = useRouter();
  const { getIdToken } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sessions, setSessions] = useState<TripReportEligibleSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const token = await getIdToken();
        if (!token) return;
        const result = await getTripReportEligibleSessions(token);
        if (!cancelled) {
          setSessions(result);
          setSessionId(result[0]?.id ?? "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load completed activities"
          );
        }
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!sessionId) {
      setError("Choose a completed activity");
      return;
    }
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!body.trim()) {
      setError("Add a short condition update");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to publish");
      const result = await createTripReport(token, {
        sessionId,
        title: title.trim(),
        blocks: [{ type: "text", content: body.trim() }],
      });
      router.push(`/reports/${result.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not publish this Trip Report"
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          New Trip Report
        </span>
      </div>

      <h1 className="text-2xl font-semibold mb-2">New Trip Report</h1>
      <p className="text-sm text-gray-500 mb-8">
        Trip Reports are public. Peaks links the destinations and route from your
        activity but does not share its GPS track.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="activity"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Completed activity
          </label>
          <select
            id="activity"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            disabled={sessionsLoading || sessions.length === 0}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {sessions.length === 0 && (
              <option value="">
                {sessionsLoading ? "Loading activities..." : "No ready activities"}
              </option>
            )}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name} · {new Date(session.date).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Title
          </label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            placeholder="Snow above the lake"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="report"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Conditions
          </label>
          <textarea
            id="report"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={20_000}
            rows={8}
            placeholder="What should the next person know?"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Add photos and structured hazards from the Peaks app.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={submitting || sessionsLoading || sessions.length === 0}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Publishing..." : "Publish Report"}
          </button>
          <Link
            href="/discover"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
