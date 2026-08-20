import { SectionHeading } from "../ui/section-heading";

/** Before you go: the notes the catalog can honestly derive, the facilities
 * on record, and the outbound forecast link.
 *
 * No "Driving directions" row — that link is already the Directions button
 * in the action row at the top of the page, and Task 1's rule was one CTA
 * per destination, not two spellings of the same one.
 *
 * Facilities render as value-over-label cells on flat ground, the same
 * shape as a stat without pretending to be one (they're words, so no
 * mono numerals). No cell backgrounds, no rules between them.
 */
export function DestinationPlanning({
  notes,
  facilities,
  forecastUrl,
  className = "",
}: {
  notes: string[];
  facilities: Array<{ label: string; value: string }>;
  forecastUrl: string | null;
  className?: string;
}) {
  if (notes.length === 0 && facilities.length === 0 && !forecastUrl) return null;

  return (
    <section className={className} aria-labelledby="destination-planning">
      <SectionHeading>
        <span id="destination-planning">Planning</span>
      </SectionHeading>

      {notes.length > 0 ? (
        <div className="mt-4 max-w-[68ch] space-y-3 text-base leading-[1.7] text-ink-2">
          {notes.map((note, index) => (
            <p key={`${index}-${note}`}>{note}</p>
          ))}
        </div>
      ) : null}

      {facilities.length > 0 ? (
        <dl className="mt-6 grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {facilities.map((row) => (
            <div key={row.label}>
              <dd className="text-[15px] text-ink">{row.value}</dd>
              <dt className="mt-0.5 text-[12px] text-muted">{row.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {forecastUrl ? (
        <p className="mt-6 text-sm">
          <a
            href={forecastUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-text hover:underline"
          >
            Point forecast from NOAA →
          </a>
        </p>
      ) : null}
    </section>
  );
}
