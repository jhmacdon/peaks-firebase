// EmptyState — icon-less, muted, centered, no box (design-tokens.md law 2
// reads on any stat; this extends the same "flat ground" idea to empty
// panels — no border, no fill). `children` stays the primary API so every
// existing call site (freeform headline/sentence/action markup) keeps
// compiling; `title`/`description`/`action` are an optional, slightly
// more structured alternative for new callers.
export function EmptyState({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-10 text-center text-sm text-muted ${className}`.trim()}>
      {title ? <p className="font-medium text-ink-2">{title}</p> : null}
      {description ? <p className={title ? "mt-1" : undefined}>{description}</p> : null}
      {children}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
