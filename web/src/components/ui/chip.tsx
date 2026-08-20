"use client";

import type { ButtonHTMLAttributes } from "react";

// Chip — a selectable pill (filters, tag toggles). Unselected: neutral
// outline. Selected: accent-text label + accent border + a faint accent
// fill (the "outlined, not filled" reading of the accent budget — chips
// are small and plural, so a filled accent background per chip would blow
// the "never on large backgrounds" rule; the tint is the .chip-selected
// color-mix rule in globals.css). Distinct from `Badge`, which is a
// non-interactive status/category label.
export function Chip({
  selected = false,
  onRemove,
  className = "",
  children,
  ...rest
}: {
  selected?: boolean;
  onRemove?: () => void;
  className?: string;
  children: React.ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  const tone = selected
    ? "chip-selected border-accent text-accent-text"
    : "border-border text-ink-2 hover:border-ink-2";

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${tone} ${className}`.trim()}
      {...rest}
    >
      {children}
      {onRemove ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Remove"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="text-faint hover:text-ink-2"
        >
          ×
        </span>
      ) : null}
    </button>
  );
}
