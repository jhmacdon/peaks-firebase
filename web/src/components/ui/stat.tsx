// Compact sans-serif values with explicit units and readable labels.
export type StatScale = "hero" | "page" | "topline" | "card";

const SCALE_CLASSES: Record<StatScale, string> = {
  hero: "text-[56px] font-semibold",
  page: "text-[36px] font-semibold",
  topline: "text-[28px] font-semibold",
  card: "text-[20px] font-normal",
};

export function StatCluster({
  value,
  unit,
  label,
  scale = "card",
  className = "",
}: {
  value: string;
  unit?: string;
  label: string;
  scale?: StatScale;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-col ${className}`.trim()}>
      <span
        className={`font-sans tabular-nums leading-none text-ink ${SCALE_CLASSES[scale]}`}
      >
        {value}
        {unit ? <span className="ml-1 text-[0.6em] text-ink-2">{unit}</span> : null}
      </span>
      <span className="mt-1.5 text-sm text-muted">{label}</span>
    </div>
  );
}
