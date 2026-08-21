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
      {/* 32 then 40 — both are steps on the display ladder
          (design-tokens.md, "Type"). A 40px wide-cut Archivo H1 takes five
          lines on a 375px screen for a long title, which an activity named
          after every destination it reached hits routinely. */}
      <h1 className="font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]">
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
