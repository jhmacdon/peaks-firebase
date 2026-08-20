// PageHeader — breadcrumb slot + display H1 + meta row slot. The H1 uses
// the Archivo display face at its wide axis setting (design-tokens.md,
// "Type": 32/40/52/64px, weight 620-700, -0.015em tracking) — reserved for
// page H1s and marketing headings, never body/UI text.
export function PageHeader({
  breadcrumb,
  title,
  meta,
  className = "",
}: {
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex flex-col gap-3 ${className}`.trim()}>
      {breadcrumb}
      <h1 className="font-display text-[40px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink">
        {title}
      </h1>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
