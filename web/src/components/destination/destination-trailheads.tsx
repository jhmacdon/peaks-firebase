import type { AmenityCredit, AmenityRow } from "../../lib/trailhead-road-access";
import { SectionHeading } from "../ui/section-heading";

/** The drive in and what waits at the end of it: the road, the parking, what
 * it costs, and whether there's a restroom.
 *
 * Quiet rows on hairline dividers (the same shape as route/route-segments),
 * not boxed cells — each row carries a short answer, the sentences that
 * qualify it underneath, and every source is credited once at the foot of
 * the section. Nothing the catalog doesn't know is printed: a fact with no
 * value is a row that never renders, and with no rows at all the section is
 * absent rather than empty.
 *
 * Values are words, so they stay on the text face — except an answer that
 * leads with a figure ("12 vehicles", "$5/day"), which is a numeral and
 * takes Geist Mono like every other numeral on the page. "Roughly 10–25
 * cars" leads with a word and is prose, so it does not.
 */
const LEADS_WITH_A_FIGURE = /^[$\d]/;

export function DestinationTrailheads({
  rows,
  credits,
  className = "",
}: {
  rows: AmenityRow[];
  credits: AmenityCredit[];
  className?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className={className} aria-labelledby="destination-trailhead">
      <SectionHeading>
        <span id="destination-trailhead">Trailhead access</span>
      </SectionHeading>

      <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
        {rows.map((row) => (
          <div key={row.label} className="py-3">
            <dt className="text-[12px] text-muted">{row.label}</dt>
            <dd
              className={`mt-0.5 text-[15px] text-ink ${
                LEADS_WITH_A_FIGURE.test(row.value) ? "font-mono-num" : ""
              }`.trim()}
            >
              {row.value}
            </dd>
            {row.captions?.map((caption) => (
              <dd key={caption} className="mt-1 text-[13px] text-ink-2">
                {caption}
              </dd>
            ))}
          </div>
        ))}
      </dl>

      {credits.length > 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          Sources:{" "}
          {credits.map((credit, index) => (
            <span key={credit.name}>
              {index > 0 ? " · " : ""}
              {credit.url ? (
                <a
                  href={credit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ink-2"
                >
                  {credit.name}
                </a>
              ) : (
                credit.name
              )}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
