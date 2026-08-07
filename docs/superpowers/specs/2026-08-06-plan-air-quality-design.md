# Plan Air Quality & Wildfire Smoke Forecast — Design

**Date:** 2026-08-06
**Status:** Approved
**Surface:** Plans (API + web card + iOS handoff spec)

## Goal

Answer "how is wildfire smoke projected to affect my hike?" on a plan's detail
screen. A plan has a date and a location; the feature shows the expected smoke
and air quality for that place on that date, at no data cost.

## Data sources

| Source | Role | Coverage | Horizon | Cost |
|--------|------|----------|---------|------|
| NOAA HRRR-Smoke (AWS Open Data, `noaa-hrrr-bdp-pds`) | Primary smoke signal | CONUS, 3 km | 48 h (00/06/12/18 UTC cycles) | Free |
| Open-Meteo Air Quality API (CAMS) | Fill beyond 48 h + non-CONUS + timezone | Global, ~11–25 km | 7 days | Free, no key, CC BY 4.0 (attribution required) |

HRRR's `MASSDEN` field is smoke-only near-surface PM2.5 (µg/m³) — it isolates
wildfire smoke from background haze, which is exactly the question. CAMS
ingests satellite fire emissions, so its total PM2.5 forecast also carries
smoke, at lower resolution and specificity.

Both sources are model output. Current-hour values can differ from the nearest
AirNow monitor. AirNow blending is a noted future extension, not in scope.

## Architecture

Three pieces: a scheduled ingestion job (new), an API endpoint (new), and a
web card (new). iOS adopts the endpoint later via the handoff spec.

### 1. Smoke ingestion job — `cloud-sql/smoke-job/`

A Cloud Run Job (Node 20 + ecCodes in the image — `libeccodes-tools` is in
Debian bookworm; `wgrib2` is not packaged there), triggered by Cloud
Scheduler 4×/day at 02:15, 08:15, 14:15, 20:15 UTC — about 2¼ h after each
48-hour HRRR cycle, when files are complete.

Each run:

1. **Collect sample points.** One point per plan where `date` is between
   `now() - 24h` and `now() + 60h`: the plan's first destination by ordinal,
   else `ST_PointOnSurface(path::geometry)`, else skip. Points snap to a
   ~3 km grid: `latIdx = round(lat / 0.03)`, `lngIdx = round(lng / 0.03)`,
   `cell_key = "{latIdx}:{lngIdx}"`; the sampled coordinate is the cell
   center. Nearby plans share cells. Points outside the HRRR CONUS domain
   (lat 21–53, lng −134 to −60, approximate) are skipped.
2. **Pick the cycle.** Latest 00/06/12/18 UTC cycle whose `f48` file exists
   (check the `.idx` sidecar). If none newer than what's stored, exit.
3. **Fetch the smoke field.** For f00–f48, read the `.idx` sidecar for
   `hrrr.tHHz.wrfsfcfNN.grib2`, find the `MASSDEN` (8 m mass density) record,
   and byte-range-download just that record (~1 MB/hour, ~50 MB/run).
4. **Extract point values.** Run `grib_get -l <lat>,<lng>,1 <file>`
   (ecCodes nearest-gridpoint mode) per cell; parse the numeric stdout.
   Convert kg/m³ → µg/m³ (×10⁹). Fallback if nearest-mode ever fails on
   HRRR's Lambert grid: `grib_get_data` full-field dump + JS nearest match.
5. **Store.** Upsert into `smoke_forecasts`; newer runs win. Prune rows with
   `valid_at < now() - 24h`.

If zero plans qualify, the run exits after step 1 without touching S3.
Failures log to Cloud Run and the run exits nonzero (visible in job history);
the endpoint degrades to CAMS, so a missed run never breaks the card.

### 2. Schema — `cloud-sql/migrations/20260806_smoke_forecasts.sql`

```sql
CREATE TABLE smoke_forecasts (
    cell_key     TEXT NOT NULL,
    valid_at     TIMESTAMPTZ NOT NULL,
    run_at       TIMESTAMPTZ NOT NULL,          -- HRRR cycle time
    smoke_ug_m3  DOUBLE PRECISION NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cell_key, valid_at)
);
CREATE INDEX idx_smoke_forecasts_valid_at ON smoke_forecasts (valid_at);
```

Owned by `postgres`; `peaks-api` gets SELECT/INSERT/UPDATE/DELETE. Applied
manually as `postgres` (CI does not apply migrations; password in Secret
Manager). No BIGINT/NUMERIC columns, so no wire-type parser work.

### 3. API endpoint — `GET /api/plans/:id/air-quality`

Access: owner or party member, same EXISTS pattern as
`/:id/reached-destinations`. Unknown or inaccessible plan → 404.

Flow:

1. Resolve the sample point (same rule as the job: first destination, else
   `ST_PointOnSurface`, else `available: false, reason: "no_location"`).
2. Read `smoke_forecasts` rows for the plan's cell with
   `valid_at >= now() - 1h` (covers "now" through +48 h when fresh).
3. Fetch Open-Meteo hourly `pm2_5,us_aqi` with `timezone=auto`,
   `forecast_days=7`, through an in-process cache keyed by cell
   (TTL 60 min, LRU-capped at 500 entries).
4. Merge per hour: HRRR value where a row exists, else CAMS. Bucket hours
   into local days using the Open-Meteo timezone; if Open-Meteo is down but
   HRRR rows exist, bucket with a crude `round(lng / 15)`-hour offset and
   still serve (degraded, rare).
5. Both sources empty → `available: false, reason: "upstream_unavailable"`
   (HTTP 200; the plan page must never break on a smoke hiccup).

Response:

```jsonc
{
  "available": true,
  "point": { "lat": 44.27, "lng": -71.3 },
  "timezone": "America/New_York",
  "planDate": "2026-08-08",            // local date; null if plan undated
  "planDayBeyondHorizon": false,        // true when planDate > last day
  "days": [
    {
      "date": "2026-08-06",
      "source": "hrrr_smoke",           // "hrrr_smoke" | "cams" | "mixed"
      "pm25Max": 22.4,                  // µg/m³; smoke-only on HRRR hours
      "usAqiMax": 73,                   // CAMS hours only; null otherwise
      "category": "moderate",
      "isPlanDay": false,
      "hours": [
        { "time": "2026-08-06T14:00:00-04:00", "source": "hrrr_smoke",
          "pm25": 18.1, "category": "moderate" }
      ]
    }
  ],
  "sources": { "hrrrRun": "2026-08-06T12:00:00Z", "cams": true }
}
```

Semantics:

- **`category` is always derived from PM2.5** via the EPA 2024 breakpoints
  (below), for cross-source consistency. `usAqiMax` is reported raw on CAMS
  hours as secondary context (it includes ozone etc.).
- HRRR hours are smoke-only PM2.5; CAMS hours are total PM2.5. Clients label
  HRRR values "smoke" and CAMS values "PM2.5".
- A day mixing sources is `"mixed"`; each hour carries its own `source`.
- Plan dated beyond day 7 → full series + `planDayBeyondHorizon: true`; the
  card says "smoke forecast opens about a week before your hike."
- Undated plan → `planDate: null`; card shows today + week ahead.
- A plan created inside the 48 h window shows CAMS values until the next
  6-hourly job run silently upgrades those hours to HRRR.

### Category mapping (EPA 2024 PM2.5 breakpoints, µg/m³)

| Category | Range |
|----------|-------|
| good | ≤ 9.0 |
| moderate | 9.1 – 35.4 |
| unhealthy_sensitive | 35.5 – 55.4 |
| unhealthy | 55.5 – 125.4 |
| very_unhealthy | 125.5 – 225.4 |
| hazardous | > 225.4 |

Applied per hour. The official index averages over 24 h (NowCast); per-hour
application is the standard display simplification and slightly conservative
during sharp smoke peaks. Noted here so nobody "fixes" it into a bug report.

### 4. Web card — plan detail page

One card, "Air quality", following the Peaks card conventions (one clear
card; lead with the strongest fact; compact supporting row):

- **Headline:** plan day's category + peak value — "Moderate — smoke up to
  22 µg/m³ Saturday afternoon". Undated plan: current conditions headline.
- **Hourly strip:** plan-day hours colored by category (daylight hours
  emphasized).
- **Next-days row:** small per-day category chips for the rest of the series.
- **Credit line:** "NOAA HRRR-Smoke · Open-Meteo (CAMS, CC BY 4.0)" — the
  Open-Meteo attribution is a license requirement.
- `available: false` or fetch error → card renders nothing.

Category colors follow the standard AQI palette (green, yellow, orange, red,
purple, maroon), tuned to the app theme in implementation.

### 5. iOS handoff spec

`docs/superpowers/specs/2026-08-06-plan-air-quality-ios-handoff.md`: endpoint
contract, category table + colors, card layout guidance mirroring the web
card. iOS work happens in its own repo.

## Deployment & ops

- `deploy.yml` gains a `deploy-smoke-job` job: build/lint/test, then
  `gcloud run jobs deploy peaks-smoke-job --source=cloud-sql/smoke-job`
  (its own Dockerfile with ecCodes; the deploy-cloudrun action's `job` input
  has no source builds, so this is a bash step) in `donner-a8608`,
  us-central1, with the Cloud SQL instance attached and the full env/secret
  set pinned in the command, matching the deploy-api pinning policy.
- Cloud Scheduler trigger (cron `15 2,8,14,20 * * *`, UTC) created once by
  `scripts/setup-smoke-scheduler.sh` (gcloud, OAuth-authenticated `jobs:run`
  call), not managed by CI.
- Cost: S3 open data is free; job compute is minutes/day; Open-Meteo is
  keyless. Effectively $0.
- Open-Meteo's free tier is non-commercial. Fine while Peaks is free; if it
  monetizes, swap in their paid tier or another source behind the endpoint —
  clients never change.

## Testing

Node's built-in test runner, matching `bigint-parser.test.ts`:

- Category mapping at every breakpoint edge.
- Merge logic: HRRR wins inside 48 h; CAMS fills beyond; gaps fall through;
  day `source` labeling (single-source vs mixed); plan-day flagging incl.
  beyond-horizon and undated cases.
- Sample-point resolution: destination → path midpoint → unavailable.
- Job: cell snapping, `.idx` record selection, and `wgrib2` stdout parsing
  against text fixtures.
- CI runs API tests already; smoke-job tests wire into its `deploy-smoke-job`
  build steps. Post-deploy: manual check of a real plan's card.

## Out of scope / future

- AirNow monitor blending for current conditions.
- HRRR-Alaska (same pipeline, `alaska` product).
- Push alert when a plan enters the 48 h window with elevated smoke.
- Destination-page air quality (reuse the same fetch/merge module).
