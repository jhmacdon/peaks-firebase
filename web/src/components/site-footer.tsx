import Link from "next/link";

// SiteFooter — surface background, four link columns, a data-attribution
// line. Exported for Task 9 to mount in the shared layouts; the three
// legal pages (about/privacy/terms) render it directly in the meantime so
// they ship complete on their own (see task-8-brief.md).
const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

const COLUMNS: Array<{
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}> = [
  {
    heading: "Explore",
    links: [
      { label: "Discover", href: "/discover" },
      { label: "Map", href: "/map" },
      { label: "Lists", href: "/lists" },
      { label: "Areas", href: "/areas" },
      { label: "Peaks by state", href: "/peaks" },
    ],
  },
  {
    heading: "Activity",
    links: [
      { label: "Log", href: "/log" },
      { label: "Plans", href: "/plans" },
      { label: "Trip reports", href: "/discover#recent-reports" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Features", href: "/features" },
      { label: "App Store", href: APP_STORE_URL, external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

const DATA_SOURCES = [
  { label: "OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
  {
    label: "USGS PAD-US",
    href: "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview",
  },
  { label: "Peakbagger", href: "https://www.peakbagger.com/" },
];

const LINK_CLASSES = "text-sm text-ink-2 no-underline hover:underline";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-hairline bg-surface">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                {column.heading}
              </p>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK_CLASSES}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={LINK_CLASSES}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-hairline pt-6 text-xs text-faint">
          © {year} Peaks · Data:{" "}
          {DATA_SOURCES.map((source, index) => (
            <span key={source.label}>
              <a
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-faint hover:text-ink-2 hover:underline"
              >
                {source.label}
              </a>
              {index < DATA_SOURCES.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
