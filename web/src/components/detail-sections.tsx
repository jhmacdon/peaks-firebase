import Link from "next/link";

// Shared building blocks for the editorial detail pages (destination and
// route guides). See web/docs/destination-page-spec.md for the visual rules.

export const DIFFICULTY_CLASSES: Record<string, string> = {
  Easy: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  Moderate: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300",
  Hard: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  Strenuous: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
};

export function DifficultyPill({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        DIFFICULTY_CLASSES[label] || DIFFICULTY_CLASSES.Moderate
      }`}
    >
      {label}
    </span>
  );
}

// Unified on the "›" separator (design-tokens.md-era convention) — several
// other pages still hand-roll a "/"-separated breadcrumb inline; those are
// out of scope here and get folded onto this component in a later nav task.
export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted">
      <Link href="/discover" className="hover:text-ink hover:underline">
        Discover
      </Link>
      <span aria-hidden>›</span>
      <span className="text-ink-2">{current}</span>
    </nav>
  );
}

// StatCell / StatRow — retinted to tokens. Every numeral is Geist Mono
// (design-tokens.md "Type"). StatCell's callers (destination/route detail
// pages) lay it out with a `gap-px` + gray background grid — a 1px-divider
// trick that depends on each cell painting its own opaque background, so a
// true "never box a stat" (law 2) flatten here would turn that grid into a
// solid block on two pages Task 8 is scoped not to touch (their flagship
// re-skin is Task 13/14, where this reverts to StatCluster `topline` and
// the grid wrapper goes away). `bg-page` keeps the divider illusion working
// with a real token in the meantime instead of raw `bg-white`/`gray-950`.
export function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-page px-4 py-3">
      <div className="font-mono-num tabular-nums text-lg text-ink">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function StatRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd
        className={`text-right font-medium text-ink ${
          mono ? "font-mono-num tabular-nums text-[13px]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function SidePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <h2 className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** "fire-lookout" → "Fire lookout" */
export function titleize(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
