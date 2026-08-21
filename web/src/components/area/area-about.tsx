import { SectionHeading } from "../ui/section-heading";

/** The place, in words — same shell as DestinationAbout
 * (components/destination/destination-about.tsx). The credit line covers
 * two different obligations depending on what's on record: a licensed
 * description credits its source, and a boundary drawn from the catalog's
 * own generic copy still credits the boundary data (PAD-US). */
export function AreaAbout({
  name,
  description,
  sourceName,
  sourceUrl,
  sourceLicense,
  fallbackCredit,
  className = "",
}: {
  name: string;
  description: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceLicense: string | null;
  fallbackCredit: string;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="area-about">
      <SectionHeading>
        <span id="area-about">About {name}</span>
      </SectionHeading>
      <p className="mt-4 max-w-[68ch] text-base leading-[1.7] text-ink-2">{description}</p>
      {sourceName ? (
        <p className="mt-3 text-[13px] text-muted">
          Adapted from{" "}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink-2"
            >
              {sourceName}
            </a>
          ) : (
            sourceName
          )}
          {sourceLicense ? ` · ${sourceLicense}` : ""}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-muted">Boundary data: {fallbackCredit}</p>
      )}
    </section>
  );
}
