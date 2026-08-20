import type { RouteProvenance } from "../../lib/route-provenance";
import type { ParsedExternalRouteLink } from "../../lib/route-guide";
import { SectionHeading } from "../ui/section-heading";

function sourceLabel(sourceKind: string): string {
  return sourceKind.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Where the line came from, and where else to find it — quiet text, no
 * box (design-tokens.md law 1/2). Geometry provenance is a licence
 * obligation, not decoration, so it stays close to the map even though
 * it's plain text rather than a bordered notice. */
export function RouteSource({
  provenance,
  externalLinks,
  className = "",
}: {
  provenance: RouteProvenance | null;
  externalLinks: ParsedExternalRouteLink[];
  className?: string;
}) {
  if (!provenance && externalLinks.length === 0) return null;

  const retrievedAt = provenance ? new Date(provenance.retrieved_at) : null;
  const retrievedLabel =
    retrievedAt && !Number.isNaN(retrievedAt.getTime())
      ? retrievedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : null;

  return (
    <section className={className} aria-labelledby="route-source">
      <SectionHeading>
        <span id="route-source">Source &amp; links</span>
      </SectionHeading>
      <div className="mt-4 space-y-3 text-[13px] leading-[1.6] text-muted">
        {provenance ? (
          <p>
            Route geometry source:{" "}
            <a
              href={provenance.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent-text hover:underline"
            >
              {sourceLabel(provenance.source_kind)}
            </a>
            {" · "}
            {provenance.attribution}
            {" · "}
            <a
              href={provenance.license_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent-text hover:underline"
            >
              {provenance.license_name}
            </a>
            {provenance.contains_osm_geometry && provenance.osm_way_urls.length > 0 ? (
              <>
                {" · "}
                <a
                  href={provenance.osm_way_urls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-text hover:underline"
                >
                  {provenance.osm_way_urls.length === 1 ? "View source way" : "View a source way"}
                </a>
              </>
            ) : null}
            {retrievedLabel ? ` · Retrieved ${retrievedLabel}` : ""}
          </p>
        ) : null}
        {externalLinks.length > 0 ? (
          <ul className="space-y-1.5">
            {externalLinks.map((link) => (
              <li key={`${link.type}:${link.id}`}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-text hover:underline"
                >
                  {link.label}
                </a>
                <span className="ml-2">{link.display}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
