import { SectionHeading } from "../ui/section-heading";

/** The route, in words — same shell as DestinationAbout
 * (components/destination/destination-about.tsx): SectionHeading over a
 * 68ch-measure paragraph. Routes don't carry a licensed catalog
 * description, so this renders the guide's short generated sentences
 * instead of a single prose block. */
export function RouteAbout({
  name,
  paragraphs,
  className = "",
}: {
  name: string;
  paragraphs: string[];
  className?: string;
}) {
  if (paragraphs.length === 0) return null;

  return (
    <section className={className} aria-labelledby="route-about">
      <SectionHeading>
        <span id="route-about">About {name}</span>
      </SectionHeading>
      <div className="mt-4 max-w-[68ch] space-y-3 text-base leading-[1.7] text-ink-2">
        {paragraphs.map((paragraph, index) => (
          <p key={`${index}-${paragraph}`}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}
