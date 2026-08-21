// StatCluster — the one stat shape used everywhere (web/docs/design-tokens.md,
// "StatCluster scale"). Geist Mono value + a smaller inline unit span + a
// 12px muted sentence-case label below. Never a background, never a border
// (law 2, "never box a stat") — callers must not wrap this in a card or
// bordered cell.
export type StatScale = "hero" | "page" | "topline" | "card";

const SCALE_CLASSES: Record<StatScale, string> = {
  hero: "text-[56px] font-light",
  page: "text-[36px] font-light",
  topline: "text-[28px] font-light",
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
        className={`font-mono-num tabular-nums leading-none text-ink ${SCALE_CLASSES[scale]}`}
      >
        {value}
        {unit ? <span className="ml-1 text-[0.6em] text-ink-2">{unit}</span> : null}
      </span>
      <span className="mt-1.5 text-[12px] text-muted">{label}</span>
    </div>
  );
}
