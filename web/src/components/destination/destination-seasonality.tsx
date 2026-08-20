import { MONTH_ABBREVIATIONS, peakMonthIndexes } from "../../lib/destination-detail";
import { SectionHeading } from "../ui/section-heading";

/** When people actually come here — twelve tracks in `--fill`, each filled
 * from the bottom by its share of the busiest month.
 *
 * The busiest month (or months, on a tie) is the one bar in accent: an
 * active-state marker, which the accent budget allows, rather than a
 * coloured chart series, which it doesn't. Every other bar is ink.
 *
 * No caption naming the peak months — the Planning notes above already say
 * "Traffic peaks in July and August" in words, from the same data, and one
 * page shouldn't state the same fact twice.
 */
export function DestinationSeasonality({
  counts,
  className = "",
}: {
  counts: number[];
  className?: string;
}) {
  const max = Math.max(...counts, 0);
  if (max <= 0) return null;
  const peaks = new Set(peakMonthIndexes(counts));

  return (
    <section className={className} aria-labelledby="destination-seasonality">
      <SectionHeading>
        <span id="destination-seasonality">Seasonality</span>
      </SectionHeading>
      <div className="mt-5 flex max-w-[440px] items-end gap-1.5">
        {counts.map((count, index) => (
          <div key={MONTH_ABBREVIATIONS[index]} className="flex-1">
            <div
              className="rounded-ctl bg-fill flex h-16 items-end overflow-hidden"
              title={`${MONTH_ABBREVIATIONS[index]}: ${count.toLocaleString("en-US")}`}
            >
              <div
                className={`rounded-t-ctl w-full ${peaks.has(index) ? "bg-accent" : "bg-ink-2"}`}
                style={{ height: `${count > 0 ? Math.max((count / max) * 100, 6) : 0}%` }}
              />
            </div>
            <div
              className={`font-mono-num mt-2 text-center text-[11px] ${
                peaks.has(index) ? "text-ink" : "text-muted"
              }`}
            >
              {MONTH_ABBREVIATIONS[index][0]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
