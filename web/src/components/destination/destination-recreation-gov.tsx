import type { ParsedExternalLink } from "../../lib/external-links";
import { SectionHeading } from "../ui/section-heading";

export function DestinationRecreationGov({
  link,
}: {
  link: ParsedExternalLink | null;
}) {
  if (!link) return null;

  return (
    <section aria-labelledby="destination-recreation-gov">
      <SectionHeading>
        <span id="destination-recreation-gov">Camping</span>
      </SectionHeading>
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-between gap-4 border-y border-hairline py-3 text-sm"
      >
        <span>
          <span className="block font-medium text-accent-text hover:underline">
            Check availability on Recreation.gov
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            See dates, fees, and booking details on Recreation.gov.
          </span>
        </span>
        <span aria-hidden className="text-muted">↗</span>
      </a>
    </section>
  );
}
