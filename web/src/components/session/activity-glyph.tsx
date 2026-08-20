import type { SessionActivityType } from "../../lib/actions/sessions";

// One small line glyph per recorded activity type, drawn in `currentColor`
// so it takes the muted meta-line colour it sits in rather than spending any
// of the accent budget (design-tokens.md, "Accent budget"). Stroked at 1.5
// to sit beside 13px meta text without out-weighing it.
//
// The fallback is the Peaks two-summit mark itself: an activity whose type
// the recorder never set is still an outdoor activity, and a generic dot
// would say less than the product's own symbol.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Peaks() {
  return <path d="M2 19 8.5 7.5 13 15.5 15.5 11 22 19Z" {...STROKE} />;
}

function Ski() {
  // Two poles crossing a slope, the shape a trail map uses.
  return (
    <>
      <path d="M4 20 16 4" {...STROKE} />
      <path d="M9 20 20 6" {...STROKE} />
      <path d="M3 15h4" {...STROKE} />
    </>
  );
}

function Moto() {
  return (
    <>
      <circle cx="5.5" cy="16.5" r="3.5" {...STROKE} />
      <circle cx="18.5" cy="16.5" r="3.5" {...STROKE} />
      <path d="M5.5 16.5 10 9h5l3.5 7.5" {...STROKE} />
      <path d="M12 5h3" {...STROKE} />
    </>
  );
}

export function ActivityGlyph({
  activityType,
  className = "h-5 w-5",
}: {
  activityType: SessionActivityType | null;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {activityType === "ski" ? (
        <Ski />
      ) : activityType === "outdoor-moto" ? (
        <Moto />
      ) : (
        <Peaks />
      )}
    </svg>
  );
}

/** The one-line trophy that marks a destination reached — a cup, not a
 * badge shelf (audit §7.4: "achievements compressed to one line"). */
export function TrophyGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z" {...STROKE} />
      <path d="M7 5.5H4.5v1.5a3 3 0 0 0 3 3" {...STROKE} />
      <path d="M17 5.5h2.5V7a3 3 0 0 1-3 3" {...STROKE} />
      <path d="M12 14v3.5" {...STROKE} />
      <path d="M8.5 20h7" {...STROKE} />
    </svg>
  );
}
