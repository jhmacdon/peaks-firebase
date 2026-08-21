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
      <Link href={href} className={`group ${cls}`}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}
