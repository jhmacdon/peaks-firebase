"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TripReportBlock } from "../lib/actions/trip-reports";
import { maybeDownscaleImage } from "../lib/image-downscale";
import { REPORT_PHOTO_UPLOAD_LIMITS, validateImageFile } from "../lib/image-upload";
import { uploadReportPhoto, type ImageUploadHandle } from "../lib/storage";
import { Button } from "./ui/button";
import { Label, Input, Textarea } from "./ui/field";

function PhotoFields({ block, userId, sessionId, onChange, onBusy }: {
  block: TripReportBlock;
  userId: string;
  sessionId: string | null;
  onChange: (patch: Partial<TripReportBlock>) => void;
  onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<ImageUploadHandle | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; upload.current?.cancel(); };
  }, []);
  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validation = validateImageFile(file, REPORT_PHOTO_UPLOAD_LIMITS);
    if (!validation.ok) { setError(validation.error); return; }
    setBusy(true); onBusy(true); setError(null); setProgress(0);
    try {
      const { blob, contentType } = await maybeDownscaleImage(file);
      if (!mounted.current) return;
      const handle = uploadReportPhoto(userId, sessionId, blob, contentType, (fraction) => {
        if (mounted.current) setProgress(Math.round(fraction * 100));
      });
      upload.current = handle;
      const url = await handle.promise;
      if (mounted.current) { setFailedImage(null); onChange({ content: url }); }
    } catch { if (mounted.current) setError("Photo upload failed. Choose the photo again to retry."); }
    finally { upload.current = null; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  return <div>
    {block.content && failedImage !== block.content && <div className="mb-4 overflow-hidden rounded-media bg-fill">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.content} alt={block.caption || "Report photo preview"} className="max-h-72 w-full object-contain" onError={() => setFailedImage(block.content)} />
    </div>}
    {failedImage === block.content && block.content && <p role="alert" className="mb-4 text-sm text-alert">This photo could not be displayed. Replace it or try opening the original.</p>}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy || !sessionId}>{busy ? `Uploading… ${progress}%` : block.content ? "Replace photo" : "Choose photo"}</Button>{block.content && <a href={block.content} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-text hover:underline">Open original</a>}</div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={choose} aria-label="Choose a report photo" className="hidden" />
    <p role="status" className="mt-2 text-xs text-muted">{busy ? `Photo upload ${progress}%` : `${REPORT_PHOTO_UPLOAD_LIMITS.label}. Up to ${REPORT_PHOTO_UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB.`}</p>
    {!sessionId && <p className="mt-2 text-sm text-muted">This older report has no linked activity, so new photos cannot be attached.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
    <Label htmlFor={`${id}-caption`} className="mt-4">Caption (optional)</Label>
    <Input id={`${id}-caption`} value={block.caption || ""} onChange={(event) => onChange({ caption: event.target.value })} placeholder="What does this photo show?" />
  </div>;
}

export default function BlockEditor({ blocks, onChange, userId, sessionId, onBusyChange }: {
  blocks: TripReportBlock[];
  onChange: (blocks: TripReportBlock[]) => void;
  userId: string;
  sessionId: string | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const current = useRef(blocks);
  current.current = blocks;
  const [busyPhotos, setBusyPhotos] = useState<Set<string>>(new Set());
  const busy = busyPhotos.size > 0;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const busyChanged = useCallback((key: string, active: boolean) => setBusyPhotos((previous) => {
    const next = new Set(previous); if (active) next.add(key); else next.delete(key); return next;
  }), []);
  const photos = blocks.filter((block) => block.type === "photo");
  const body = blocks.filter((block) => block.type === "text").map((block) => block.content).join("\n\n");
  const updatePhoto = (key: string, patch: Partial<TripReportBlock>) => onChange(current.current.map((block, index) => (block.sourceId || `photo-${index}`) === key ? { ...block, ...patch } : block));
  const reorder = (index: number, step: number) => {
    const reordered = [...photos];
    const [photo] = reordered.splice(index, 1); reordered.splice(index + step, 0, photo);
    onChange([...blocks.filter((block) => block.type === "text"), ...reordered]);
  };
  return <div className="space-y-8">
    <div><Label htmlFor={`${id}-body`}>Your trip report</Label><Textarea id={`${id}-body`} value={body} onChange={(event) => onChange([{ type: "text", content: event.target.value }, ...current.current.filter((block) => block.type === "photo")])} rows={9} maxLength={20000} placeholder="Conditions, highlights, and what the next person should know" required /><p className="mt-2 text-xs text-muted">Share what you saw, including the date and any changes to the route.</p></div>
    <section aria-labelledby={`${id}-photos`}><h2 id={`${id}-photos`} className="text-lg font-medium text-ink">Photos</h2><p className="mt-2 text-sm text-muted">Your photos appear after the report, in this order.</p>
      <div className="mt-5 space-y-8">{photos.map((photo, index) => {
        const blockIndex = blocks.indexOf(photo);
        const key = photo.sourceId || `photo-${blockIndex}`;
        return <div key={key}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium text-ink">Photo {index + 1}</p><div className="flex gap-2"><Button type="button" variant="quiet" aria-label={`Move photo ${index + 1} earlier`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}>Move up</Button><Button type="button" variant="quiet" aria-label={`Move photo ${index + 1} later`} disabled={busy || index === photos.length - 1} onClick={() => reorder(index, 1)}>Move down</Button><Button type="button" variant="quiet" disabled={busy} onClick={() => onChange(blocks.filter((block) => block !== photo))}>Remove photo</Button></div></div>
          <PhotoFields block={photo} userId={userId} sessionId={sessionId} onChange={(patch) => updatePhoto(key, patch)} onBusy={(active) => busyChanged(key, active)} />
        </div>;
      })}</div>
      <Button type="button" variant="secondary" disabled={!sessionId || busy} className="mt-5" onClick={() => onChange([...blocks, { type: "photo", content: "", caption: "", sourceId: `draft-${crypto.randomUUID()}` }])}>Add a photo</Button>
    </section>
  </div>;
}
