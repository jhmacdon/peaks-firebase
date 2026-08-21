import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// Field controls — Input/Select/Textarea + Label, one flat shell shared by
// all three (rounded-ctl, border-border, bg-page). Focus is the global
// :focus-visible accent ring (globals.css); the border darkening to accent
// on focus is an extra, non-load-bearing affordance.
const CONTROL_BASE =
  "w-full rounded-ctl border border-border bg-page px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export function Label({
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`mb-1.5 block text-sm font-medium text-ink-2 ${className}`.trim()}
      {...props}
    />
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-10 ${CONTROL_BASE} ${className}`.trim()} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`h-10 ${CONTROL_BASE} ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-24 py-2 ${CONTROL_BASE} ${className}`.trim()}
      {...props}
    />
  );
}
