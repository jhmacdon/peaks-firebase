import Link from "next/link";

// Card — flat shell for list-item cards (destination/route/list/report
// grids). rounded-media is the only radius option available to a
// non-control container (design-tokens.md Radius table has no other step).
// Hover darkens the fill token rather than lifting/scaling/growing a shadow
// (law 6).
const BASE =
  "block rounded-media border border-border bg-surface p-4 transition-colors hover:bg-fill";

export function Card({
  href,
  className = "",
  children,
}: {
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `${BASE} ${className}`.trim();
  if (href) {
    return (
      // Catalog grids can hold dozens of database-backed detail links. A
      // production Next.js prefetch for each visible card turns one browse
      // request into a burst of detail renders and can exhaust the small
      // Cloud SQL pool before a reader clicks anything.
      <Link href={href} prefetch={false} className={`group ${cls}`}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}
