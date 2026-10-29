import Link from "next/link";
import {
  feetValue,
  formatAreaMi2,
  formatPercentChange,
  formatLengthMiles,
  glacierFactRows,
  isCombinedHistory,
  type GlacierFacts,
  type GlacierRouteCrossing,
  type GlacierSummary,
} from "../../lib/glaciers";
import { formatMiles } from "../../lib/destination-detail";
import { SectionHeading } from "../ui/section-heading";

/** Quiet definition rows: label, the value in the page's primary units,
 * and the metric equivalent or method as a muted second line. */
export function GlacierFactList({ facts, className = "" }: { facts: GlacierFacts; className?: string }) {
  const rows = glacierFactRows(facts);
  if (rows.length === 0) return null;

  return (
    <section id="glacier-facts" className={`scroll-mt-24 ${className}`.trim()} aria-labelledby="glacier-facts-heading">
      <SectionHeading eyebrow={facts.observed_year ? `Measured ${facts.observed_year}` : undefined}>
        <span id="glacier-facts-heading">{facts.kind === "snowfield" ? "Snowfield facts" : "Glacier facts"}</span>
      </SectionHeading>
      <dl className="mt-4 grid gap-x-10 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
            <dt className="text-sm text-muted">{row.label}</dt>
            <dd className="text-right">
              <span className="block text-[15px] font-medium tabular-nums text-ink">{row.value}</span>
              {row.detail ? <span className="block text-[12px] tabular-nums text-muted">{row.detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function GlacierRoutes({
  name,
  kind,
  routes,
  className = "",
}: {
  name: string;
  kind: GlacierFacts["kind"];
  routes: GlacierRouteCrossing[];
  className?: string;
}) {
  return (
    <section id="glacier-routes" className={`scroll-mt-24 ${className}`.trim()} aria-labelledby="glacier-routes-heading">
      <SectionHeading>
        <span id="glacier-routes-heading">Routes across {name}</span>
      </SectionHeading>
      {routes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No published Peaks route crosses this {kind} yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {routes.map((route) => {
            const onIce = [
              route.on_ice_m != null ? `${formatMiles(route.on_ice_m)} on ${kind === "snowfield" ? "snow" : "ice"}` : null,
              route.min_elevation_m != null && route.max_elevation_m != null
                ? `${feetValue(route.min_elevation_m)}–${feetValue(route.max_elevation_m)} ft`
                : null,
              route.pass_count > 1 ? `${route.pass_count} crossings` : null,
            ].filter(Boolean);
            const whole = [
              route.distance != null ? `${formatMiles(route.distance)} route` : null,
              route.gain != null ? `${feetValue(route.gain)} ft gain` : null,
            ].filter(Boolean);
            return (
              <li key={route.id}>
                <Link href={`/routes/${route.id}`} className="group block">
                  <span className="block text-base font-medium text-ink group-hover:underline">{route.name || "Unnamed route"}</span>
                  {onIce.length || whole.length ? (
                    <span className="mt-0.5 block text-[13px] text-muted">{[...onIce, ...whole].join(" · ")}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-5 max-w-[68ch] text-[13px] leading-5 text-muted">
        {kind === "snowfield"
          ? "Permanent snowfields hide crevasses at their edges and lose all definition in a whiteout. Carry navigation, and check current conditions before you go."
          : "Glacier travel needs a rope team, crevasse-rescue skills, and current conditions. Crevasses open and bridges thin through the season; distances on ice come from the mapped outline, not a guaranteed line."}
      </p>
    </section>
  );
}

/** Sidebar roster of the other glaciers on the same mountain. */
export function GlacierSiblings({
  currentId,
  parentName,
  hubHref,
  glaciers,
  className = "",
}: {
  currentId: string;
  parentName: string;
  hubHref: string | null;
  glaciers: GlacierSummary[];
  className?: string;
}) {
  const others = glaciers.filter((g) => g.id !== currentId);
  if (others.length === 0) return null;
  const shown = others.slice(0, 12);

  return (
    <section className={className} aria-labelledby="glacier-siblings">
      <h2 id="glacier-siblings" className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
        More on {parentName}
      </h2>
      <ul className="mt-4 space-y-3.5">
        {shown.map((glacier) => (
          <li key={glacier.id}>
            <Link href={`/destinations/${glacier.id}`} className="group block">
              <span className="block truncate text-[15px] font-medium text-ink group-hover:underline">{glacier.name}</span>
              <span className="mt-0.5 block text-[12px] tabular-nums text-muted">
                {[
                  glacier.area_km2 != null ? formatAreaMi2(glacier.area_km2) : glacier.kind === "snowfield" ? "Snowfield" : null,
                  glacier.head_elevation_m != null ? `top ${feetValue(glacier.head_elevation_m)} ft` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hubHref ? (
        <Link href={hubHref} className="mt-5 inline-block text-sm font-medium text-accent-text hover:underline">
          All {glaciers.length} on {parentName} →
        </Link>
      ) : null}
    </section>
  );
}

/** The full roster on a mountain page and the glacier hub. */
export function GlacierRosterTable({
  glaciers,
  caption,
  className = "",
}: {
  glaciers: GlacierSummary[];
  caption: string;
  className?: string;
}) {
  if (glaciers.length === 0) return null;

  return (
    <div className={`overflow-x-auto ${className}`.trim()}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-[13px] text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-2.5 pr-4 font-medium">Name</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">Area</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">Top</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">Terminus</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">Length</th>
            <th scope="col" className="py-2.5 text-right font-medium">Area change</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-ink-2">
          {glaciers.map((glacier) => {
            const combined = isCombinedHistory(glacier);
            return (
              <tr key={glacier.id} className="border-b border-hairline last:border-b-0">
                <th scope="row" className="py-3 pr-4 font-normal">
                  <Link href={`/destinations/${glacier.id}`} className="font-medium text-ink hover:underline">
                    {glacier.name}
                  </Link>
                  {glacier.kind === "snowfield" ? <span className="ml-2 text-[12px] text-muted">Snowfield</span> : null}
                </th>
                <td className="py-3 pr-4 text-right">{glacier.area_km2 != null ? formatAreaMi2(glacier.area_km2) : "—"}</td>
                <td className="py-3 pr-4 text-right">{glacier.head_elevation_m != null ? `${feetValue(glacier.head_elevation_m)} ft` : "—"}</td>
                <td className="py-3 pr-4 text-right">
                  {glacier.terminus_elevation_m != null ? `${feetValue(glacier.terminus_elevation_m)} ft` : "—"}
                </td>
                <td className="py-3 pr-4 text-right">{glacier.length_km != null ? formatLengthMiles(glacier.length_km) : "—"}</td>
                <td className="py-3 text-right">
                  {glacier.percent_change_since_earliest != null && glacier.history_start_year != null ? (
                    <span title={combined ? `Measured together as ${glacier.area_history_scope}` : undefined}>
                      {formatPercentChange(glacier.percent_change_since_earliest)}
                      <span className="ml-1 text-[12px] text-muted">
                        since {glacier.history_start_year}
                        {combined ? "*" : ""}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {glaciers.some((g) => isCombinedHistory(g) && g.percent_change_since_earliest != null) ? (
        <p className="mt-3 text-[12px] text-muted">
          * Survey history measures this glacier together with a neighbour, so the change is for the combined area.
        </p>
      ) : null}
    </div>
  );
}

export function GlacierSources({ facts, className = "" }: { facts: GlacierFacts; className?: string }) {
  const outline = facts.outline;
  const outlineDate = outline?.observed_at
    ? `imagery from ${formatMonthYear(outline.observed_at)}`
    : outline?.snapshot_at ?? facts.outline_mapped_at
      ? `as mapped in ${formatMonthYear((outline?.snapshot_at ?? facts.outline_mapped_at)!)}`
      : null;
  const licenseUrl = outline?.license_url ?? licenseLink(facts.geometry_license);
  const outlineSource = outline?.source_url ?? facts.outline_source_url;
  const report = facts.report;

  return (
    <section id="glacier-sources" className={`scroll-mt-24 ${className}`.trim()} aria-labelledby="glacier-sources-heading">
      <SectionHeading>
        <span id="glacier-sources-heading">Sources</span>
      </SectionHeading>
      <ul className="mt-4 max-w-[68ch] space-y-3 text-sm leading-6 text-ink-2">
        {facts.facts_credit ? (
          <li>
            <span className="text-muted">Measurements and survey history: </span>
            <ExternalLink href={report?.url ?? facts.facts_source_url}>{facts.facts_credit}</ExternalLink>
            {report?.license ? ` · ${report.license}` : ""}
            {report?.doi ? <span className="text-muted"> · DOI {report.doi}</span> : null}
          </li>
        ) : null}
        {facts.geometry_credit ? (
          <li>
            <span className="text-muted">Outline: </span>
            <ExternalLink href={outlineSource}>{facts.geometry_credit}</ExternalLink>
            {facts.geometry_license ? (
              <>
                {" · "}
                <ExternalLink href={licenseUrl}>{facts.geometry_license}</ExternalLink>
              </>
            ) : null}
            {outlineDate ? `, ${outlineDate}` : ""}. Past trips are matched to this outline.
          </li>
        ) : null}
      </ul>
      <p className="mt-3 max-w-[68ch] text-[13px] text-muted">
        Measurements describe the survey year shown; glaciers change every season. Elevations are converted from meters and
        rounded to the nearest foot.
      </p>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
      {children}
    </a>
  );
}

function licenseLink(license: string | null | undefined): string | null {
  switch (license) {
    case "ODbL-1.0":
      return "https://www.openstreetmap.org/copyright";
    case "CC0-1.0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "CC-BY-4.0":
      return "https://creativecommons.org/licenses/by/4.0/";
    default:
      return null;
  }
}

function formatMonthYear(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
