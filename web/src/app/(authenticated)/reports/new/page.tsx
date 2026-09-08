"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { createTripReport, getTripReportEligibleSessions, type TripReportEligibleSession, type TripReportBlock } from "../../../../lib/actions/trip-reports";
import ReportEditor from "../../../../components/report-editor";
import { Button } from "../../../../components/ui/button";
import { Label, Select } from "../../../../components/ui/field";
import { EmptyState } from "../../../../components/ui/empty-state";

export default function NewReportPage() {
  return <Suspense fallback={<EmptyState>Opening report editor…</EmptyState>}><NewReportForm /></Suspense>;
}

function NewReportForm() {
  const router = useRouter();
  const params = useSearchParams();
  const destinationId = params.get("dest") || params.get("destinationId") || undefined;
  const requestedSessionId = params.get("sessionId") || params.get("session") || undefined;
  const { user, getIdToken } = useAuth();
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<TripReportBlock[]>([{ type: "text", content: "" }]);
  const [sessions, setSessions] = useState<TripReportEligibleSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to choose an activity.");
      const result = await getTripReportEligibleSessions(token, { destinationId, sessionId: requestedSessionId });
      setSessions(result); setSessionId((current) => result.some((session) => session.id === current) ? current : result[0]?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn’t load your activities."); }
    finally { setLoading(false); }
  }, [getIdToken, destinationId, requestedSessionId]);
  useEffect(() => { void load(); }, [load]);
  return <div className="mx-auto max-w-3xl px-6 py-10">
    <Button href="/log" variant="quiet">← Your activities</Button>
    <h1 className="mt-5 font-display text-[32px] font-[680] text-ink sm:text-[40px]">Write a trip report</h1>
    <p className="mt-3 text-muted">Share the conditions, photos, and details that will help the next person.</p>
    {destinationId && <p className="mt-3 text-sm text-muted">Choose a completed activity that reached this place.</p>}
    {loading ? <EmptyState>Loading completed activities…</EmptyState> : error ? <EmptyState><p role="alert">{error}</p><Button className="mt-4" onClick={load}>Try again</Button></EmptyState> : sessions.length === 0 ? <EmptyState title={requestedSessionId ? "This activity isn’t ready for a report" : destinationId ? "No completed visits are ready" : "Choose an outing first"} description="Reports start from a completed activity after Peaks finishes processing it. Each activity can have one report."><div className="mt-5 flex flex-wrap justify-center gap-3"><Button href="/log/import">Import an activity</Button><Button href={requestedSessionId ? `/log/${encodeURIComponent(requestedSessionId)}` : "/log"} variant="secondary">Open your activities</Button>{(destinationId || requestedSessionId) && <Button href="/reports/new" variant="secondary">Choose another activity</Button>}<Button onClick={load} variant="quiet">Check again</Button></div></EmptyState> : <ReportEditor
      title={title} setTitle={setTitle} blocks={blocks} setBlocks={setBlocks} userId={user?.uid ?? ""} sessionId={sessionId} busy={submitting} submitLabel="Publish report" cancelHref="/log" onUploadBusy={setUploading}
      context={<div><Label htmlFor="report-activity">Completed activity</Label><Select id="report-activity" value={sessionId} disabled={submitting || uploading || blocks.some((block) => block.type === "photo")} onChange={(event) => setSessionId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {new Date(session.date).toLocaleDateString()}</option>)}</Select>{blocks.some((block) => block.type === "photo") && <p className="mt-2 text-sm text-muted">Remove the photos before choosing a different activity.</p>}</div>}
      onSubmit={async (draft) => {
        setSubmitting(true);
        try {
          const token = await getIdToken();
          if (!token) throw new Error("Sign in again to publish your report.");
          const result = await createTripReport(token, { sessionId, ...draft });
          router.push(`/reports/${result.id}`);
        } finally { setSubmitting(false); }
      }}
    />}
  </div>;
}
