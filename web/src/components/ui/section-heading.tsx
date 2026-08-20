// SectionHeading — an in-page section label: optional eyebrow (11px,
// uppercase, +0.1em tracking, muted — see design-tokens.md's "Eyebrows"
// row) over a plain Geist heading. Sections separate by whitespace, not a
// divider (law 3) — this renders no rule of its own.
//
// Two sizes, because app pages and marketing pages set different scales
// around the heading. `md` (18px) is the app scale, where a section label
// sits above rows and cards that are 15–16px. `lg` (24px) is the marketing
// scale, where the surrounding blocks run 22px and an 18px heading would
// rank below the content it introduces. Both stay on Geist at weight 500:
// the display face starts at 32px (design-tokens.md, "Type"), so a section
// heading never reaches for it.
export type SectionHeadingSize = "md" | "lg";

const SIZE_CLASSES: Record<SectionHeadingSize, string> = {
  md: "text-lg",
  lg: "text-[24px]",
};

// `level` is the outline rank, and it is independent of `size` above. Almost
// every section on this site hangs directly off the page H1, so 2 is the
// default. A section that genuinely sits under another heading — the typed
// result groups beneath "Results for …" on Discover — passes 3, so the
// document outline matches the nesting a reader sees. Styling doesn't change
// with the rank: a subsection heading at the app scale is still 18px; only
// the tag differs.
export type SectionHeadingLevel = 2 | 3;

export function SectionHeading({
  eyebrow,
  children,
  size = "md",
  level = 2,
  className = "",
}: {
  eyebrow?: string;
  children: React.ReactNode;
  size?: SectionHeadingSize;
  level?: SectionHeadingLevel;
  className?: string;
}) {
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <div className={className}>
      {eyebrow ? (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {eyebrow}
        </p>
      ) : null}
      <Heading className={`${SIZE_CLASSES[size]} font-medium text-ink`}>
        {children}
      </Heading>
    </div>
  );
}
