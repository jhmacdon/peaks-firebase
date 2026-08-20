import assert from "node:assert/strict";
import test from "node:test";

import { buildDestinationWeatherStrip, type RawForecastEntry } from "./weather-forecast";

// A fixed reference "now" rather than the real clock — the gate compares
// forecast dates against `[now, now+3]`, so every case here needs a pinned
// instant to stay deterministic regardless of when the suite runs.
const NOW = new Date("2026-08-20T12:00:00.000Z");

test("a stale doc (real 2021 ISO instants, years out of window) yields null", () => {
  // Shaped exactly like the orphaned prod documents found during
  // investigation (Mount Rainier's doc, among others) — every date sits
  // years before `NOW`, so every entry falls out of the [today, today+3]
  // window and the whole doc resolves to "no data", not fabricated tiles.
  const forecast: RawForecastEntry[] = [
    {
      date: "2021-01-16T08:01:00.000Z",
      timezone: "America/Los_Angeles",
      temperatureMax: 281.9,
      temperatureMin: 274.9,
      rain: 0,
      snow: 0,
      wind: { speed: 3.4, direction: 160 },
    },
    {
      date: "2021-01-17T08:01:00.000Z",
      timezone: "America/Los_Angeles",
      temperatureMax: 280.8,
      temperatureMin: 273.2,
      wind: { speed: 2.8, direction: 194 },
    },
  ];

  assert.equal(buildDestinationWeatherStrip(forecast, NOW), null);
});

test("an in-window doc yields days with correct hi/lo unit conversion", () => {
  const forecast: RawForecastEntry[] = [
    {
      date: "2026-08-20T08:01:00.000Z", // same UTC calendar day as NOW
      timezone: "America/Los_Angeles",
      temperatureMax: 300, // 80.33F -> rounds to 80
      temperatureMin: 290, // 62.33F -> rounds to 62
      rain: 0,
      snow: 0,
      wind: { speed: 3.4, direction: 160 },
    },
  ];

  const result = buildDestinationWeatherStrip(forecast, NOW);
  assert.ok(result);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].label, "Today");
  assert.equal(result.days[0].highF, 80);
  assert.equal(result.days[0].lowF, 62);
});

test("an entry with no timezone of its own falls back to the doc's reference timezone, not UTC", () => {
  // NOW is 2026-08-20T16:30Z. In Asia/Tokyo (UTC+9) that instant is already
  // 2026-08-21 local — "today" in the reference timezone is one calendar
  // day ahead of "today" in UTC. The entry under test carries no
  // `timezone` of its own and is dated 2026-08-20T16:00Z, which is
  // 2026-08-21 local in Tokyo but 2026-08-20 in UTC. A UTC fallback would
  // put it one day before the window and drop it; falling back to the
  // doc's own reference timezone (seeded by the first entry that does
  // carry one) correctly lands it in "Today".
  const now = new Date("2026-08-20T16:30:00.000Z");
  const forecast: RawForecastEntry[] = [
    { timezone: "Asia/Tokyo" }, // seeds the reference timezone only — no date/temps, so it can't itself appear in `days`.
    {
      date: "2026-08-20T16:00:00.000Z",
      // no `timezone` field here — must inherit the reference timezone.
      temperatureMax: 295,
      temperatureMin: 288,
    },
  ];

  const result = buildDestinationWeatherStrip(forecast, now);
  assert.ok(result);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].label, "Today");
});

test("missing wind direction renders \"—\"; missing wind speed and precip collapse to 0 (current behavior)", () => {
  // Known ambiguity, not resolved here: the source doc never distinguishes
  // "field absent" from "field measured zero", so a missing `wind.speed`,
  // `rain`, or `snow` reads the same as a genuine zero. `windDirection` has
  // no natural zero, so only it gets the "—" placeholder. This test
  // pins that asymmetry as the documented current behavior.
  const forecast: RawForecastEntry[] = [
    {
      date: "2026-08-20T08:01:00.000Z",
      timezone: "America/Los_Angeles",
      temperatureMax: 300,
      temperatureMin: 290,
      // rain, snow, wind.speed, wind.direction all absent.
      wind: {},
    },
  ];

  const result = buildDestinationWeatherStrip(forecast, NOW);
  assert.ok(result);
  const [day] = result.days;
  assert.equal(day.windMph, 0);
  assert.equal(day.precipIn, 0);
  assert.equal(day.precipKind, "none");
  assert.equal(day.windDirection, "—");
});
