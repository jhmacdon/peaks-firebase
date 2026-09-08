"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { TripReportBlock } from "../lib/actions/trip-reports";
import { prepareReportDraft } from "../lib/report-draft";
import BlockEditor from "./block-editor";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/field";

export default function ReportEditor({ title, setTitle, blocks, setBlocks, userId, sessionId, context, busy, disabled = false, submitLabel, onSubmit, cancelHref, onUploadBusy }: {
  title: string;
  setTitle: (value: string) => void;
  blocks: TripReportBlock[];
  setBlocks: (value: TripReportBlock[]) => void;
  userId: string;
  sessionId: string | null;
  context?: ReactNode;
  busy: boolean;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (draft: ReturnType<typeof prepareReportDraft>) => Promise<void>;
  cancelHref: string;
  onUploadBusy?: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof prepareReportDraft> | null>(null);
  const blocked = busy || uploading || disabled;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setError(null);
    try { await onSubmit(prepareReportDraft(title, blocks)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn’t save your report. Try again."); }
  }
  function showPreview() {
    setError(null);
    try { setDraft(prepareReportDraft(title, blocks)); setPreview(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Add a title and report before previewing."); }
  }
  const uploadBusy = useCallback((value: boolean) => { setUploading(value); onUploadBusy?.(value); }, [onUploadBusy]);
  return <form onSubmit={submit} className="mt-8 space-y-8">
    <div className="rounded-media bg-fill px-5 py-4"><p className="font-medium text-ink">Public trip report</p><p className="mt-1 text-sm leading-6 text-muted">Anyone can read your report and photos. Peaks links the places and routes from your activity; its GPS track stays separate.</p></div>
    {context}
    <div className="flex items-center gap-2" role="group" aria-label="Report view"><Button type="button" variant={preview ? "quiet" : "secondary"} onClick={() => setPreview(false)} disabled={busy} aria-pressed={!preview}>Write</Button><Button type="button" variant={preview ? "secondary" : "quiet"} onClick={showPreview} disabled={blocked} aria-pressed={preview}>Preview</Button></div>
    <fieldset disabled={busy || disabled} hidden={preview} className="space-y-8 disabled:opacity-60">
      <div><Label htmlFor="report-title">Title</Label><Input id="report-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required placeholder="Snow above the lake" /></div>
      <BlockEditor blocks={blocks} onChange={setBlocks} userId={userId} sessionId={sessionId} onBusyChange={uploadBusy} />
    </fieldset>
    {preview && draft && <article className="space-y-6" aria-label="Report preview"><h2 className="font-display text-[32px] font-[680] text-ink">{draft.title}</h2>{draft.blocks.map((block, index) => block.type === "text" ? <div key={index} className="space-y-4 text-[17px] leading-relaxed text-ink-2">{block.content.split(/\n\n+/).map((paragraph, i) => <p key={i} className="whitespace-pre-wrap">{paragraph}</p>)}</div> : <figure key={block.sourceId || index}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.content} alt={block.caption || "Trip report photo"} className="max-h-[640px] w-full rounded-media object-contain" />{block.caption && <figcaption className="mt-2 text-sm text-muted">{block.caption}</figcaption>}
    </figure>)}</article>}
    {uploading && <p role="status" className="text-sm text-muted">Finish uploading photos before saving or previewing.</p>}
    {error && <p role="alert" className="text-sm text-alert">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={blocked}>{busy ? "Saving…" : submitLabel}</Button><Button href={cancelHref} variant="secondary" aria-disabled={busy || uploading} onClick={(event) => { if (busy || uploading) event.preventDefault(); }}>Cancel</Button></div>
  </form>;
}
