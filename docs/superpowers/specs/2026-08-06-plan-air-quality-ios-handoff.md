# Plan Air Quality — iOS Handoff

**Date:** 2026-08-06
**Backend design:** `2026-08-06-plan-air-quality-design.md`

The API serves a merged wildfire-smoke + air-quality forecast per plan. iOS
renders it as one card on the plan detail screen. No client-side source
logic: the server already merged HRRR-Smoke and CAMS and labeled every hour.

## Endpoint

`GET /api/plans/:id/air-quality` — standard `Authorization: Bearer
<firebase-id-token>`; caller must be the plan owner or a party member
(404 otherwise).

```jsonc
{
  "available": true,                    // false → hide the card entirely
  "reason": null,                       // key is omitted unless available=false
  "point": { "lat": 44.27, "lng": -71.3 },
  "timezone": "America/New_York",       // IANA name; all times are local ISO8601 with offset
  "planDate": "2026-08-08",             // local date of the plan; null if undated
  "planDayBeyondHorizon": false,
  "days": [
    {
      "date": "2026-08-06",
      "source": "hrrr_smoke",           // "hrrr_smoke" | "cams" | "mixed"
      "pm25Max": 22.4,                  // µg/m³
      "usAqiMax": 73,                   // null on pure HRRR days
      "category": "moderate",
      "isPlanDay": false,
      "hours": [
        { "time": "2026-08-06T14:00:00-04:00", "source": "hrrr_smoke",
          "pm25": 18.1, "category": "moderate" }
      ]
    }
  ],
  "sources": { "hrrrRun": "2026-08-06T12:00:00.000Z", "cams": true }
}
```

All numeric fields are JSON numbers (no string-wrapped numerics on this
endpoint). Parse defensively anyway per the usual `PeaksAPI` conventions.

## Semantics you must respect

- `source: "hrrr_smoke"` hours are **smoke-only** PM2.5 — label the value
  "smoke". `source: "cams"` hours are **total** PM2.5 — label it "PM2.5".
- `category` is server-computed; never re-derive it on the client.
- `available: false` → render nothing. Never block or error the plan screen
  on this endpoint; treat network failure the same as `available: false`.
- `planDayBeyondHorizon: true` → headline reads "Smoke forecast opens about
  a week before your hike"; still show the days that exist.
- `planDate: null` (undated plan) → headline is current conditions.

## Card layout (mirrors web)

Order on the plan detail screen: after the plan facts, before photos —
follow the existing card order conventions.

1. **Headline:** plan day's category + peak value + when — "Moderate — smoke
   up to 22 µg/m³ Saturday afternoon".
2. **Hourly strip:** plan-day hours as a compact colored strip (category
   color per hour), daylight emphasized.
3. **Next-days row:** one small chip per remaining day (weekday initial +
   category color).
4. **Credit line (required):** "NOAA HRRR-Smoke · Open-Meteo (CAMS, CC BY
   4.0)". The Open-Meteo attribution is a license condition, not styling.

## Category colors

Standard AQI palette, adjusted to the app theme:

| category | color |
|----------|-------|
| good | green |
| moderate | yellow |
| unhealthy_sensitive | orange |
| unhealthy | red |
| very_unhealthy | purple |
| hazardous | maroon |
