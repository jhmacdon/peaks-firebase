import type { DestinationWeatherDay } from "../../lib/actions/weather";
import { SectionHeading } from "../ui/section-heading";

// The AllTrails weather-tile pattern: an unboxed row of small flat tiles,
// each just `bg-fill` + `rounded-ctl` (design-tokens.md law 2 — never box
// a stat, but a forecast tile isn't a stat, it's a small flat card, so the
// one-step radius + subtle fill is allowed here the way it is for the
// Seasonality bars). No border, no shadow — "unboxed beyond that".
//
// Never-null per field: `label`, `highF`/`lowF`, `precipIn`, `windMph`,
// and `windDirection` are always concrete values from
// `lib/actions/weather.ts` (0 for a legitimate zero, "—" only for the
// source doc's own missing direction) — nothing here prints `undefined`.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function PrecipGlyph({ kind }: { kind: DestinationWeatherDay["precipKind"] }) {
  if (kind === "none") return null;
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-ink-2" aria-hidden="true">
      {kind === "snow" ? (
        <>
          <path d="M12 3v18" {...STROKE} />
          <path d="M5 7.5 19 16.5" {...STROKE} />
          <path d="M19 7.5 5 16.5" {...STROKE} />
        </>
      ) : (
        <path d="M12 3.5c3.5 4.5 6 7.7 6 10.5a6 6 0 1 1-12 0c0-2.8 2.5-6 6-10.5Z" {...STROKE} />
      )}
    </svg>
  );
}

/** Compact today+3 forecast strip. Rendered only when the page already has
 * real, in-window forecast days (see `lib/actions/weather.ts`) — this
 * component also self-guards so it's safe to call directly. */
export function DestinationWeather({
  days,
  forecastUrl,
  className = "",
}: {
  days: DestinationWeatherDay[];
  forecastUrl: string | null;
  className?: string;
}) {
  if (days.length === 0) return null;

  return (
    <section className={className} aria-labelledby="destination-weather">
      <SectionHeading>
        <span id="destination-weather">Weather</span>
      </SectionHeading>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {days.map((day, index) => (
          <div key={`${day.label}-${index}`} className="rounded-ctl bg-fill px-3 py-3">
            <div className="text-[12px] text-muted">{day.label}</div>
            <div className="font-mono-num mt-2 text-[15px] text-ink">
              {day.highF}°<span className="text-ink-2">/{day.lowF}°</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[12px] text-ink-2">
              <PrecipGlyph kind={day.precipKind} />
              <span className="font-mono-num">{day.precipIn.toFixed(1)}&quot;</span>
            </div>
            <div className="mt-1 text-[12px] text-muted">
              <span className="font-mono-num text-ink-2">{day.windMph}</span> mph {day.windDirection}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[13px] text-muted">
        {forecastUrl ? (
          <>
            <a
              href={forecastUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Full forecast →
            </a>
            {" · "}
          </>
        ) : null}
        Forecast by{" "}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-ink-2"
        >
          Open-Meteo
        </a>
      </p>
    </section>
  );
}
