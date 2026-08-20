import { SectionHeading } from "../ui/section-heading";

/** Designation, manager, region — value-over-label cells on flat ground,
 * the same shape DestinationPlanning uses for facility facts
 * (components/destination/destination-planning.tsx). No box, no rules
 * between cells (design-tokens.md law 1/2). */
export function AreaFacts({
  facts,
  className = "",
}: {
  facts: Array<{ label: string; value: string }>;
  className?: string;
}) {
  if (facts.length === 0) return null;

  return (
    <section className={className} aria-labelledby="area-facts">
      <SectionHeading>
        <span id="area-facts">Catalog facts</span>
      </SectionHeading>
      <dl className="mt-4 grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3">
        {facts.map((row) => (
          <div key={row.label} className="flex flex-col-reverse">
            <dt className="mt-0.5 text-[12px] text-muted">{row.label}</dt>
            <dd className="text-[15px] text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
