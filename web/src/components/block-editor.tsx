"use client";

import { useCallback, useRef, useState } from "react";
import type { TripReportBlock } from "../lib/actions/trip-reports";
import { maybeDownscaleImage } from "../lib/image-downscale";
import { REPORT_PHOTO_UPLOAD_LIMITS, validateImageFile } from "../lib/image-upload";
import { uploadReportPhoto } from "../lib/storage";
import { Button } from "./ui/button";
import { Label, Input, Textarea } from "./ui/field";

const REPORT_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

interface PhotoBlockFieldsProps {
  content: string;
  caption: string;
  userId: string;
  sessionId: string | null;
  onChange: (updates: Partial<TripReportBlock>) => void;
}

/** The photo half of a block: upload control (with progress + inline
 * error), preview, and caption. Upload state (uploading/progress/error) is
 * local to one block, not lifted to BlockEditor, since each photo block
 * uploads independently. */
function PhotoBlockFields({
  content,
  caption,
  userId,
  sessionId,
  onChange,
}: PhotoBlockFieldsProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file after an error
      if (!file) return;

      const validation = validateImageFile(file, REPORT_PHOTO_UPLOAD_LIMITS);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);
      try {
        const { blob, contentType } = await maybeDownscaleImage(file);
        const url = await uploadReportPhoto(
          userId,
          sessionId,
          blob,
          contentType,
          (fraction) => setProgress(Math.round(fraction * 100))
        );
        onChange({ content: url });
      } catch {
        setError("Upload failed. Try again.");
      } finally {
        setUploading(false);
      }
    },
    [onChange, userId, sessionId]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading
            ? `Uploading… ${progress}%`
            : content
              ? "Replace photo"
              : "Choose photo"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={REPORT_PHOTO_ACCEPT}
          onChange={handleFileChange}
          className="hidden"
        />
        <span className="text-xs text-faint">{REPORT_PHOTO_UPLOAD_LIMITS.label}. Up to 10MB.</span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}

      {content && (
        <div className="rounded-ctl overflow-hidden border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content}
            alt={caption || "Photo"}
            className="max-h-48 w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <Input
        type="text"
        value={caption}
        onChange={(e) => onChange({ caption: e.target.value })}
        placeholder="Caption (optional)"
      />
    </div>
  );
}

interface BlockEditorProps {
  blocks: TripReportBlock[];
  onChange: (blocks: TripReportBlock[]) => void;
  /** Needed to scope uploaded photos under `trip-reports/{userId}/{sessionId}/…`
   * per storage.rules. */
  userId: string;
  sessionId: string | null;
}

export default function BlockEditor({
  blocks,
  onChange,
  userId,
  sessionId,
}: BlockEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addTextBlock = useCallback(() => {
    onChange([...blocks, { type: "text", content: "" }]);
  }, [blocks, onChange]);

  const addPhotoBlock = useCallback(() => {
    onChange([...blocks, { type: "photo", content: "", caption: "" }]);
  }, [blocks, onChange]);

  const updateBlock = useCallback(
    (index: number, updates: Partial<TripReportBlock>) => {
      const updated = blocks.map((block, i) =>
        i === index ? { ...block, ...updates } : block
      );
      onChange(updated);
    },
    [blocks, onChange]
  );

  const deleteBlock = useCallback(
    (index: number) => {
      onChange(blocks.filter((_, i) => i !== index));
    },
    [blocks, onChange]
  );

  const moveBlock = useCallback(
    (index: number, direction: "up" | "down") => {
      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= blocks.length) return;

      const updated = [...blocks];
      const [moved] = updated.splice(index, 1);
      updated.splice(newIndex, 0, moved);
      onChange(updated);
    },
    [blocks, onChange]
  );

  return (
    <div className="space-y-4">
      <Label>Content Blocks</Label>

      {blocks.length === 0 && (
        <div className="text-sm text-muted py-6 text-center rounded-media border border-border bg-surface">
          No blocks yet. Add a text or photo block to get started.
        </div>
      )}

      <div className="space-y-3">
        {blocks.map((block, index) => (
          <div
            key={index}
            className={`rounded-media border border-border bg-surface p-4 ${
              dragIndex === index ? "opacity-50" : ""
            }`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) {
                const updated = [...blocks];
                const [moved] = updated.splice(dragIndex, 1);
                updated.splice(index, 0, moved);
                onChange(updated);
              }
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            {/* Block header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="cursor-grab text-faint hover:text-ink-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                    <circle cx="15" cy="6" r="1" fill="currentColor" />
                    <circle cx="9" cy="12" r="1" fill="currentColor" />
                    <circle cx="15" cy="12" r="1" fill="currentColor" />
                    <circle cx="9" cy="18" r="1" fill="currentColor" />
                    <circle cx="15" cy="18" r="1" fill="currentColor" />
                  </svg>
                </span>
                <span className="text-xs font-medium text-muted uppercase tracking-wide">
                  {block.type === "text"
                    ? "Text"
                    : block.placement === "header"
                      ? "Header photo"
                      : "Photo"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveBlock(index, "up")}
                  disabled={index === 0}
                  className="p-1 text-faint hover:text-ink-2 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => moveBlock(index, "down")}
                  disabled={index === blocks.length - 1}
                  className="p-1 text-faint hover:text-ink-2 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => deleteBlock(index)}
                  className="p-1 text-alert/70 hover:text-alert"
                  title="Delete block"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Block content */}
            {block.type === "text" ? (
              <Textarea
                value={block.content}
                onChange={(e) =>
                  updateBlock(index, { content: e.target.value })
                }
                placeholder="Write your text here..."
                rows={4}
                className="resize-y"
              />
            ) : (
              <PhotoBlockFields
                content={block.content}
                caption={block.caption || ""}
                userId={userId}
                sessionId={sessionId}
                onChange={(updates) => updateBlock(index, updates)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add block buttons */}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={addTextBlock}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Text
        </Button>
        <Button type="button" variant="secondary" onClick={addPhotoBlock}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Photo
        </Button>
      </div>
    </div>
  );
}
