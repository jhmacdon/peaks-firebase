import Link from "next/link";
import { SectionHeading } from "../ui/section-heading";

/** One grid rhythm for the whole page: two columns from md, three from xl.
 * Discover used to run three different ones (four-up, three-up, two-up)
 * depending on which section you were looking at. */
export const DISCOVER_GRID = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

/**
 * A Discover browse section: heading at the app scale, one line of muted
 * description, an optional action on the right, then the content.
 *
 * `id` stays on the section because the footer links at
 * `/discover#recent-reports`, and because a heading you can link to is
 * cheap. Sections separate by whitespace, never a divider (law 3) — the
 * spacing lives on the parent stack, not here.
 */
export function DiscoverSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <SectionHeading>{title}</SectionHeading>
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The quiet "View all" link a section header can carry. */
export function SectionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-accent-text hover:underline">
      {children}
    </Link>
  );
}
