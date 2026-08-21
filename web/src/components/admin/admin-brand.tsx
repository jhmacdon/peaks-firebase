import Link from "next/link";

export function AdminBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/admin" className="inline-flex items-center gap-3 text-ink">
      <svg width="30" height="30" viewBox="0 0 32 32" className="shrink-0 text-accent-text" aria-hidden="true">
        <path fill="currentColor" d="M1 27 11 10l10 17H1Z" />
        <path fill="currentColor" d="M11 27 21 6l10 21H11Z" />
      </svg>
      <span className="flex items-baseline gap-2">
        <span className="font-display text-[20px] font-[650] leading-none tracking-[-0.015em]">Peaks</span>
        {!compact ? (
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Admin</span>
        ) : null}
      </span>
    </Link>
  );
}
