"use client";

import type { AqDay, PlanAirQuality } from "../lib/actions/air-quality";

// Standard AQI palette.
const CATEGORY_COLORS: Record<string, string> = {
  good: "bg-green-500",
  moderate: "bg-yellow-400",
  unhealthy_sensitive: "bg-orange-500",
  unhealthy: "bg-red-500",
  very_unhealthy: "bg-purple-600",
  hazardous: "bg-rose-900",
};

const CATEGORY_LABELS: Record<string, string> = {
  good: "Good",
  moderate: "Moderate",
  unhealthy_sensitive: "Unhealthy for sensitive groups",
  unhealthy: "Unhealthy",
  very_unhealthy: "Very unhealthy",
  hazardous: "Hazardous",
};

function headline(aq: PlanAirQuality): { day: AqDay | null; text: string } {
  const days = aq.days ?? [];
  const planDay = days.find((d) => d.isPlanDay) ?? null;
  if (!planDay && aq.planDayBeyondHorizon) {
    return { day: days[0] ?? null, text: "Smoke forecast opens about a week before your hike" };
  }
  const day = planDay ?? days[0] ?? null;
  if (!day) return { day: null, text: "" };
  const label = CATEGORY_LABELS[day.category] ?? day.category;
  const kind = day.source === "cams" ? "PM2.5" : "smoke";
  const when = planDay
    ? new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
    : "today";
  return { day, text: `${label} — ${kind} up to ${day.pm25Max} µg/m³ ${when}` };
}

export default function PlanAirQualityCard({ aq }: { aq: PlanAirQuality }) {
  const days = aq.days ?? [];
  if (days.length === 0) return null;
  const { day, text } = headline(aq);

  return (
    <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <h3 className="font-semibold mb-3">Air quality</h3>
      <div className="font-medium">{text}</div>
      {day && (
        <div className="flex gap-0.5 mt-3">
          {day.hours.map((h) => (
            <div
              key={h.time}
              className={`h-6 flex-1 rounded-sm ${CATEGORY_COLORS[h.category] ?? "bg-gray-300"}`}
              title={`${h.time.slice(11, 16)} — ${h.pm25} µg/m³`}
            />
          ))}
        </div>
      )}
      {days.length > 1 && (
        <div className="flex gap-3 mt-3 text-xs text-gray-600 dark:text-gray-400">
          {days.map((d) => (
            <span key={d.date} className="flex items-center gap-1">
              <span
                className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[d.category] ?? "bg-gray-300"}`}
              />
              {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        NOAA HRRR-Smoke · Open-Meteo (CAMS, CC BY 4.0)
      </div>
    </div>
  );
}
