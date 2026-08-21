// Badge — outlined pill, tokens only (law 5). The old per-category hue
// system (emerald/sky/amber/gray/red, one raw Tailwind color per type) is
// retired: design-tokens.md defines one neutral pair and one semantic
// (alert) pair, not a five-hue category palette, and the accent teal is
// rationed too tightly (law 4's "accent budget") to spend on a badge that
// can appear a dozen times on one page. The `tone` prop keeps its five
// values so every existing call site keeps compiling unchanged; four of
// them now render the same neutral pill, and `red` (used for destructive/
// severity signals) maps to the alert token.
type BadgeTone = "emerald" | "sky" | "amber" | "gray" | "red";

const NEUTRAL = "border-border bg-fill text-ink-2";
const ALERT = "border-alert/30 bg-alert/10 text-alert";

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald: NEUTRAL,
  sky: NEUTRAL,
  amber: NEUTRAL,
  gray: NEUTRAL,
  red: ALERT,
};

export function Badge({
  tone = "gray",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export type { BadgeTone };
