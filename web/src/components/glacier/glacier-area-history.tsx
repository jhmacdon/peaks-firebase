import {
  formatAreaKm2,
  formatAreaMi2,
  formatPercentChange,
  glacierAreaChange,
  historyScopeNote,
  km2ToMi2,
  measuredHistory,
  type GlacierFacts,
} from "../../lib/glaciers";
import { SectionHeading } from "../ui/section-heading";
import { StatCluster } from "../ui/stat";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const MIN_LABEL_GAP = 44;

/** Area over time, drawn on the server: no chart library, no client JS, and
 * the numbers ship in the HTML as a table a crawler or screen reader can
 * read. The y axis starts at zero so the retreat reads at its true scale.
 *
 * A combined history (e.g. Cowlitz-Ingraham) is labelled as such above the
 * chart — the contract forbids presenting it as one glacier's loss. */
export function GlacierAreaHistory({
  facts,
  className = "",
}: {
  facts: GlacierFacts;
  className?: string;
}) {
  const points = measuredHistory(facts.area_history);
  if (points.length < 2) return null;

  const change = glacierAreaChange(facts);
  const scopeNote = historyScopeNote(facts);
  const first = points[0];
  const last = points[points.length - 1];

  const values = points.map((p) => km2ToMi2(p.area_km2 + (p.uncertainty_km2 ?? 0)));
  const yMax = niceCeiling(Math.max(...values));
  const x = (year: number) =>
    PAD.left + ((year - first.year) / Math.max(1, last.year - first.year)) * (WIDTH - PAD.left - PAD.right);
  const y = (mi2: number) => PAD.top + (1 - mi2 / yMax) * (HEIGHT - PAD.top - PAD.bottom);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.year).toFixed(1)},${y(km2ToMi2(p.area_km2)).toFixed(1)}`).join(" ");
  const area = `${line} L${x(last.year).toFixed(1)},${y(0).toFixed(1)} L${x(first.year).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, yMax / 2, yMax];
  const labeledYears = labelYears(points.map((p) => p.year), x);

  const summary = `${scopeNote ? `${scopeNote}. ` : ""}Area went from ${formatAreaMi2(first.area_km2)} in ${first.year} to ${formatAreaMi2(
    last.area_km2
  )} in ${last.year}.`;

  return (
    <section id="glacier-history" className={`scroll-mt-24 ${className}`.trim()} aria-labelledby="glacier-history-heading">
      <SectionHeading eyebrow={facts.area_history_scope && scopeNote ? `Survey history · ${facts.area_history_scope}` : "Survey history"}>
        <span id="glacier-history-heading">Area over time</span>
      </SectionHeading>
      {scopeNote ? (
        <p className="mt-2 max-w-[68ch] text-sm text-ink-2">
          {scopeNote} in the published surveys, so this chart shows their combined area rather than {facts.name} alone.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-x-12 gap-y-5">
        <StatCluster scale="card" value={formatAreaMi2(first.area_km2).replace(" mi²", "")} unit="mi²" label={String(first.year)} />
        <StatCluster scale="card" value={formatAreaMi2(last.area_km2).replace(" mi²", "")} unit="mi²" label={String(last.year)} />
        {change ? (
          <StatCluster scale="card" value={formatPercentChange(change.percent)} label={`Since ${change.fromYear}`} />
        ) : null}
      </div>

      <figure className="mt-6">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full max-w-[720px] overflow-visible"
          role="img"
          aria-label={summary}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-hairline" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {tick === 0 ? "0" : tick.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </text>
            </g>
          ))}
          <text x={PAD.left - 8} y={PAD.top - 6} textAnchor="end" className="fill-muted text-[11px]">
            mi²
          </text>
          <path d={area} className="fill-accent/15" />
          {points.map((p) =>
            p.uncertainty_km2 ? (
              <line
                key={`e-${p.year}`}
                x1={x(p.year)}
                x2={x(p.year)}
                y1={y(km2ToMi2(p.area_km2 + p.uncertainty_km2))}
                y2={y(Math.max(0, km2ToMi2(p.area_km2 - p.uncertainty_km2)))}
                className="stroke-muted"
                strokeWidth={1}
              />
            ) : null
          )}
          <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />
          {points.map((p) => (
            <circle key={p.year} cx={x(p.year)} cy={y(km2ToMi2(p.area_km2))} r={3.5} className="fill-page stroke-accent" strokeWidth={2}>
              <title>{`${p.year}: ${formatAreaMi2(p.area_km2, p.uncertainty_km2)} (${formatAreaKm2(p.area_km2, p.uncertainty_km2)})`}</title>
            </circle>
          ))}
          {labeledYears.map((year) => (
            <text key={year} x={x(year)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
              {year}
            </text>
          ))}
        </svg>
        <figcaption className="mt-2 text-[13px] text-muted">
          Vertical bars show each survey’s published uncertainty.
          {facts.facts_credit ? ` Data: ${facts.facts_credit}.` : ""}
        </figcaption>
      </figure>

      <details className="mt-5 max-w-[560px]">
        <summary className="cursor-pointer text-sm font-medium text-accent-text">Survey data</summary>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">
            {facts.area_history_scope ? `${facts.area_history_scope} area by survey year` : `${facts.name} area by survey year`}
          </caption>
          <thead className="text-[13px] text-muted">
            <tr className="border-b border-hairline">
              <th scope="col" className="py-2 font-medium">Year</th>
              <th scope="col" className="py-2 font-medium">Area (mi²)</th>
              <th scope="col" className="py-2 font-medium">Area (km²)</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-ink-2">
            {facts.area_history.map((p) => (
              <tr key={p.year} className="border-b border-hairline last:border-b-0">
                <th scope="row" className="py-2 font-normal text-ink">{p.year}</th>
                <td className="py-2">{p.area_km2 != null ? formatAreaMi2(p.area_km2, p.uncertainty_km2).replace(" mi²", "") : "Not surveyed"}</td>
                <td className="py-2">{p.area_km2 != null ? formatAreaKm2(p.area_km2, p.uncertainty_km2).replace(" km²", "") : "Not surveyed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Keeps the first and last years and drops any label that would crowd
 * its neighbour; the last year wins a collision with the one before it. */
function labelYears(years: number[], x: (year: number) => number): number[] {
  if (years.length <= 2) return years;
  const last = years[years.length - 1];
  const kept: number[] = [years[0]];
  for (const year of years.slice(1, -1)) {
    if (x(year) - x(kept[kept.length - 1]) >= MIN_LABEL_GAP && x(last) - x(year) >= MIN_LABEL_GAP) kept.push(year);
  }
  kept.push(last);
  return kept;
}
