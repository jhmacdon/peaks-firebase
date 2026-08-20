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
//
// Defaults to Discover — the parent for a destination or route page, since
// neither has its own index yet. A page that DOES have a real index
// (/areas, /lists) overrides `parentHref`/`parentLabel` to point there
// instead, since that's the page a reader actually came from.
export function Breadcrumb({
  current,
  parentHref = "/discover",
  parentLabel = "Discover",
}: {
  current: string;
  parentHref?: string;
  parentLabel?: string;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted">
      <Link href={parentHref} className="hover:text-ink hover:underline">
        {parentLabel}
      </Link>
      <span aria-hidden>›</span>
      <span className="text-ink-2">{current}</span>
    </nav>
  );
}

// StatCell / StatRow / SidePanel used to live here for the route and area
// detail pages' boxed stat grids and bordered sidebars. The destination
// page dropped them in Task 13 for flat StatClusters and unboxed rows;
// Task 14 did the same to the route and area pages (their last two
// callers), so the boxed-stat/bordered-sidebar shapes are retired from
// this file too — see components/ui/stat.tsx (StatCluster) and each
// section's own quiet-row component instead.

// Lives in lib/destination-detail.ts now (the destination page's pure
// helpers moved there in Task 13 so they could be unit-tested); re-exported
// here so the route page's existing import keeps resolving.
export { titleize } from "../lib/destination-detail";
