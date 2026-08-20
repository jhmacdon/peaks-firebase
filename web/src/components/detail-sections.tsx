import Link from "next/link";

// Shared building blocks for the editorial detail pages (destination and
// route guides). See web/docs/destination-page-spec.md for the visual rules.

// DifficultyPill / DIFFICULTY_CLASSES used to live here: a four-hue
// emerald/sky/amber/red scale on raw Tailwind palette colours (law 5), and
// the last such palette left in this file. Its one caller, route-card.tsx,
// now prints the difficulty word in a neutral `Badge` — the word carries the
// meaning, and the token system defines no caution/severity ramp to spend a
// hue on. The route page has always shown difficulty as plain text.

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
