"use client";

import { useState, useCallback } from "react";
import type { TripReportBlock } from "../lib/actions/trip-reports";

interface BlockEditorProps {
  blocks: TripReportBlock[];
  onChange: (blocks: TripReportBlock[]) => void;
}

export default function BlockEditor({ blocks, onChange }: BlockEditorProps) {
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
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Content Blocks
      </label>

      {blocks.length === 0 && (
        <div className="text-sm text-gray-500 py-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          No blocks yet. Add a text or photo block to get started.
        </div>
      )}

      <div className="space-y-3">
        {blocks.map((block, index) => (
          <div
            key={index}
            className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 ${
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
                <span className="cursor-grab text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
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
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {block.type === "text" ? "Text" : "Photo"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveBlock(index, "up")}
                  disabled={index === 0}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
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
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
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
                  className="p-1 text-red-400 hover:text-red-600"
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
              <textarea
                value={block.content}
                onChange={(e) =>
                  updateBlock(index, { content: e.target.value })
                }
                placeholder="Write your text here..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
              />
            ) : (
              <div className="space-y-2">
                <input
                  type="url"
                  value={block.content}
                  onChange={(e) =>
                    updateBlock(index, { content: e.target.value })
                  }
                  placeholder="Image URL (e.g. https://...)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                {block.content && (
                  <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={block.content}
                      alt={block.caption || "Photo"}
                      className="max-h-48 w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
                <input
                  type="text"
                  value={block.caption || ""}
                  onChange={(e) =>
                    updateBlock(index, { caption: e.target.value })
                  }
                  placeholder="Caption (optional)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add block buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addTextBlock}
          className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Text
        </button>
        <button
          type="button"
          onClick={addPhotoBlock}
          className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Photo
        </button>
      </div>
    </div>
  );
}
