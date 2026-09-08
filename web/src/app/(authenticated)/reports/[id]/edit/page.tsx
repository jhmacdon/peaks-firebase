"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../lib/auth-context";
import { deleteTripReport, getTripReportForEdit, updateTripReport, type TripReport, type TripReportBlock } from "../../../../../lib/actions/trip-reports";
import ReportEditor from "../../../../../components/report-editor";
import { Button } from "../../../../../components/ui/button";
import { EmptyState } from "../../../../../components/ui/empty-state";

export default function EditTripReportPage() {
  const reportId = useParams().id as string;
  const router = useRouter();
  const { user, getIdToken } = useAuth();
  const [report, setReport] = useState<TripReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<TripReportBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to edit your report.");
      const result = await getTripReportForEdit(token, reportId);
      setReport(result);
      if (result) { setTitle(result.title); setBlocks(result.blocks.length > 0 ? result.blocks : [{ type: "text", content: "" }]); }
    } catch { setLoadError("Couldn’t load your report."); }
    finally { setLoading(false); }
  }, [getIdToken, reportId]);
  useEffect(() => { void load(); }, [load]);
  async function remove() {
    setDeleting(true); setDeleteError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to delete your report.");
      await deleteTripReport(token, reportId);
      router.replace("/log"); router.refresh();
    } catch (caught) { setDeleteError(caught instanceof Error ? caught.message : "Couldn’t delete your report."); }
    finally { setDeleting(false); }
  }
  return <div className="mx-auto max-w-3xl px-6 py-10">
    <Button href={`/reports/${reportId}`} variant="quiet">← Back to report</Button>
    <h1 className="mt-5 font-display text-[32px] font-[680] text-ink sm:text-[40px]">Edit trip report</h1>
    {loading ? <EmptyState>Loading report…</EmptyState> : loadError ? <EmptyState><p role="alert">{loadError}</p><Button onClick={load} className="mt-4">Try again</Button></EmptyState> : !report ? <EmptyState title="Report unavailable" description="Only the report owner can edit it. It may also have been removed." /> : <>
      <ReportEditor title={title} setTitle={setTitle} blocks={blocks} setBlocks={setBlocks} userId={user?.uid ?? ""} sessionId={report.sessionId} busy={saving} disabled={deleting} submitLabel="Save changes" cancelHref={`/reports/${reportId}`} onUploadBusy={setUploading}
        context={<div><p className="text-sm font-medium text-ink">Activity on {new Date(report.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p><p className="mt-1 text-sm text-muted">The date and linked places come from the original activity.</p></div>}
        onSubmit={async (draft) => {
          setSaving(true);
          try {
            const token = await getIdToken();
            if (!token) throw new Error("Sign in again to save your report.");
            await updateTripReport(token, reportId, draft);
            router.replace(`/reports/${reportId}`); router.refresh();
          } finally { setSaving(false); }
        }} />
      <details className="mt-12"><summary className="w-fit cursor-pointer text-sm font-medium text-muted hover:text-ink">Report settings</summary><div className="mt-5"><h2 className="text-lg font-medium text-alert">Delete report</h2><p className="mt-2 text-sm text-muted">This removes your report for everyone and cannot be undone.</p>{!confirmDelete ? <Button className="mt-4" variant="danger" disabled={uploading || saving} onClick={() => setConfirmDelete(true)}>Delete report</Button> : <div className="mt-4"><p className="text-sm text-ink">Delete “{title}”?</p><div className="mt-3 flex gap-3"><Button variant="danger" onClick={remove} disabled={deleting || uploading || saving}>{deleting ? "Deleting…" : "Yes, delete report"}</Button><Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep report</Button></div></div>}{deleteError && <p role="alert" className="mt-4 text-sm text-alert">{deleteError}</p>}</div></details>
    </>}
  </div>;
}
