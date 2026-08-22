import type { ParsedExternalLink } from "../../lib/external-links";
import { SectionHeading } from "../ui/section-heading";

export function DestinationExternalLinks({
  links,
}: {
  links: ParsedExternalLink[];
}) {
  if (links.length === 0) return null;

  return (
    <section aria-labelledby="destination-external-links">
      <SectionHeading>
        <span id="destination-external-links">More about this place</span>
      </SectionHeading>
      <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
        {links.map((link) => (
          <li key={`${link.type}:${link.href}`}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-4 py-3 text-sm"
            >
              <span className="font-medium text-accent-text group-hover:underline">
                {link.label}
              </span>
              <span className="text-xs text-muted">{link.display}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
