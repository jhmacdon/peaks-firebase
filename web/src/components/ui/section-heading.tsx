// SectionHeading — an in-page section label: optional eyebrow (11px,
// uppercase, +0.1em tracking, muted — see design-tokens.md's "Eyebrows"
// row) over a plain Geist heading. Sections separate by whitespace, not a
// divider (law 3) — this renders no rule of its own.
export function SectionHeading({
  eyebrow,
  children,
  className = "",
}: {
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow ? (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-lg font-medium text-ink">{children}</h2>
    </div>
  );
}
