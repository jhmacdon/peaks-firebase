import Link from "next/link";

// The body of the 404 page. Two files render it: the root `not-found.tsx`
// (unmatched URLs, which get no route-group layout and so bring their own
// chrome) and `(public)/not-found.tsx` (a `notFound()` call inside that
// group, which inherits nav and footer from the group layout). One component
// keeps the two from drifting apart.
const LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/map", label: "Map" },
  { href: "/lists", label: "Lists" },
  // Not "Home": `/` redirects to `/discover`, so it would repeat the first
  // link. Areas is the fourth thing the nav browses.
  { href: "/areas", label: "Areas" },
];

export function NotFoundContent() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-28">
      <div className="max-w-[68ch]">
        <h1 className="font-display text-[40px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink">
          Nothing at this elevation.
        </h1>
        <p className="mt-4 text-ink-2">
          The page you asked for isn&rsquo;t here &mdash; search from Discover, or
          take one of these.
        </p>
        <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-sm font-medium text-accent-text hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
