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
import { Button } from "../../../../components/ui/button";
import { Label, Select, Input, Textarea } from "../../../../components/ui/field";

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
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link href="/discover" className="hover:text-ink hover:underline">
          Discover
        </Link>
        <span>/</span>
        <span className="text-ink-2">New Trip Report</span>
      </div>

      <h1 className="text-2xl font-semibold mb-2 text-ink">New Trip Report</h1>
      <p className="text-sm text-muted mb-8">
        Trip Reports are public. Peaks links the destinations and route from your
        activity but does not share its GPS track.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <Label htmlFor="activity">Completed activity</Label>
          <Select
            id="activity"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            disabled={sessionsLoading || sessions.length === 0}
          >
            {sessions.length === 0 && (
              <option value="">
                {sessionsLoading ? "Loading activities…" : "No ready activities"}
              </option>
            )}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name} · {new Date(session.date).toLocaleDateString()}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            placeholder="Snow above the lake"
          />
        </div>

        <div>
          <Label htmlFor="report">Conditions</Label>
          <Textarea
            id="report"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={20_000}
            rows={8}
            placeholder="What should the next person know?"
          />
          <p className="mt-1 text-xs text-muted">
            Add photos and structured hazards from the Peaks app.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-alert/10 border border-alert/30 rounded-ctl text-sm text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4 pt-4">
          <Button type="submit" disabled={submitting || sessionsLoading || sessions.length === 0}>
            {submitting ? "Publishing…" : "Publish Report"}
          </Button>
          <Link href="/discover" className="text-sm text-muted hover:text-ink-2 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
