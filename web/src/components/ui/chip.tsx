"use client";

import type { ButtonHTMLAttributes } from "react";

// Chip — a selectable pill (filters, tag toggles). The pill itself is a
// non-interactive <span>; the selectable control and the optional remove
// control are real, independent <button>s as SIBLINGS inside it, rather
// than nesting a clickable element inside a <button> (invalid content
// model, and previously left the remove control keyboard-unreachable at
// tabIndex=-1 with no native focus). Unselected: neutral outline. Selected:
// accent-text label + accent border + a faint accent fill (the "outlined,
// not filled" reading of the accent budget — chips are small and plural,
// so a filled accent background per chip would blow the "never on large
// backgrounds" rule; the tint is the .chip-selected color-mix rule in
// globals.css). Distinct from `Badge`, which is a non-interactive
// status/category label.
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
  const removeLabel = `Remove${typeof children === "string" ? ` ${children}` : ""}`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border py-1 pl-3 ${
        onRemove ? "pr-1.5" : "pr-3"
      } text-[13px] font-medium transition-colors ${tone} ${className}`.trim()}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="appearance-none border-0 bg-transparent p-0 text-current"
        {...rest}
      >
        {children}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="appearance-none border-0 bg-transparent p-0 text-faint hover:text-ink-2"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
