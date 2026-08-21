import { SectionHeading } from "../ui/section-heading";

/** The place, in words: the catalog's own description where one exists,
 * otherwise the one-line guide headline. Set at the 68ch prose measure
 * (design-tokens.md, "Layout"), with the source credit as a muted line
 * under it — a licence obligation for the imported descriptions, so it
 * follows the text rather than the section heading. */
export function DestinationAbout({
  name,
  body,
  sourceName,
  sourceUrl,
  sourceLicense,
  className = "",
}: {
  name: string;
  body: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceLicense: string | null;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="destination-about">
      <SectionHeading>
        <span id="destination-about">About {name}</span>
      </SectionHeading>
      <p className="mt-4 max-w-[68ch] text-base leading-[1.7] text-ink-2">{body}</p>
      {sourceName ? (
        <p className="mt-3 text-[13px] text-muted">
          Source:{" "}
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
      ) : null}
    </section>
  );
}
