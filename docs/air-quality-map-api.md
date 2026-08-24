# Air-quality map API

## Readiness

The endpoint, client contract, and live file provider are ready. Production
pins `AIR_QUALITY_LIVE_ENABLED=false`, so it makes no AirNow request and returns
the typed `disabled` response. The production factory has no fixture path. An
exact `true` selects the real AirNow provider.

One owner decision blocks live use: whether Peaks should adopt AirNow under
its data-use terms. If yes, accept the [AirNow Data Exchange
Guidelines](https://docs.airnowapi.org/docs/DataUseGuidelines.pdf), complete
their contact/agreement form, and return it with a short Peaks product notice
to `dmc@airnowtech.org`. Ask the Data Management Center and EPA AirNow contact
`white.johne@epa.gov` to confirm how Peaks should notify the relevant source
agencies for a nationwide reporting-area map. Keep the sent form and written
reply. Until that step is complete, keep the flag false. Do not enable it just
because the public file needs no API key.

## Source and limits

The source is AirNow's public
[`reportingarea.dat`](https://files.airnowtech.org/airnow/today/reportingarea.dat)
file. AirNow's current [FAQ](https://docs.airnowapi.org/faq) says this file is
updated at :25 and :55 past each hour. The August 2025 [Reporting Area File Fact
Sheet](https://s3-us-west-1.amazonaws.com/files.airnowtech.org/airnow/docs/ReportingAreaFactSheet.pdf)
lists the older :10, :25, and :40 schedule. Peaks follows the newer FAQ and the
current file behavior. Observations are hourly.
Reporting areas range from part of a city to a county-sized region.
This product accepts only US state, district, and territory codes and labels
the response `coverageRegion: US` and `standard: us_epa_aqi`. An observed
reporting-area AQI is the highest AQI that the reporting agency supplied for
that area and hour. It is not an estimate at the centroid or at the user's
location.

This key-free official file avoids a paid provider and any scraped consumer
tiles. Key-free does not mean permission-free: AirNow grants no permissive
reuse license in the reviewed material, so the Data Exchange Guidelines,
owner form, and source-agency guidance still block live use.

[EPA directs real-time public reporting to AirNow](https://www.epa.gov/outdoor-air-quality-data/what-best-way-access-outdoor-air-monitoring-data);
AQS can lag and serves regulatory and trend work. Apple WeatherKit's published
[Swift queries](https://developer.apple.com/documentation/weatherkit/weatherquery)
and [REST data sets](https://developer.apple.com/documentation/weatherkitrestapi/dataset)
do not include AQI. Peaks already uses Open-Meteo for weather, but its
[free endpoint is non-commercial](https://open-meteo.com/en/terms), and this
project has no approved commercial AQI contract or key. AirNow is the sound
live source after the owner notice.

Peaks accepts only AirNow sequence `0`, data type `O`, primary pollutant `Y`
rows with the file's exact 17-field shape, decimal number syntax, and valid
source dates and clock times. It passes through the source AQI, category text,
primary pollutant, observation date and time, time-zone label, centroid, and
agency. It maps the six source category names to stable slugs for clients, but
it does not compute AQI, turn pollutant values into AQI, interpolate values, or
change a category to match a number. It rejects a source row when its AQI and
category disagree with the EPA ranges. AQI above 500 remains Hazardous when
AirNow supplies that category.

AirNow data are preliminary and may change. They are for current AQI reporting,
not regulatory decisions or trend analysis. Each display must:

- show `Participating air agencies and U.S. EPA AirNow • Preliminary` and the
  record's source agency;
- say that the data are preliminary;
- say that the marker is a reporting-area centroid, not exact local air;
- show the observation or update time;
- use the EPA category names and colors without changing the values; and
- link to [AirNow](https://www.airnow.gov/) and include a short, non-medical
  health-context note.

AirNow has data-use terms rather than an open-source software license. The
terms require the source credit, preliminary label, current data, unchanged
values, owner notice, and current contact details described above.

## Public endpoint

`GET /public/air-quality/viewport?west=&south=&east=&north=&zoom=` sits before
Firebase auth. The main map works before sign-in, the data are public and the
response has no user fields or provider key. Requiring Firebase auth would add
user linkage without protecting a secret or licensed record.

The endpoint accepts one plain decimal for each bound and one whole-number zoom
from 4 through 14. Bounds must be finite and ordered. A box cannot cross the
date line. The first iOS client treats a crossing view as outside the supported
bounds; a later client can split it into two calls. A zoom-linked span cap
stops whole-country harvesting and keeps a two-cell, 0.2-degree floor at close
zooms so outward rounding still works through zoom 14. The client must round
each bound outward to a 0.1-degree grid before it builds the GET URL. The
server rejects finer bounds, then echoes the checked grid box. This keeps exact
view coordinates out of Cloud Run request URLs while nearby pans can share
work.

Every valid response includes the quantized viewport, AirNow source and terms
links, the preliminary and precision labels, nullable update and stale times,
and these fields:

```text
status: fresh | stale | no_data | disabled | rate_limited | error
reportingAreas: []
reason: owner_notice_required | upstream_unavailable | upstream_invalid | null
retryAfterSeconds: number | null
```

Data and no-data responses use HTTP 200. Disabled and upstream-error responses
use 503. Rate limits use 429 and `Retry-After`. Bad viewports use 400 with an
`invalid_viewport` error. The full camel-case record shape is defined in
`cloud-sql/api/src/air-quality-reporting-area.ts`.

## Cache and failure rules

The provider has a process-local, single-flight cache. It fetches the full
reporting-area file once, then filters it for each quantized viewport. Its
pinned policy is a 20-minute fresh TTL, a two-hour
source-age stale threshold, and a hard six-hour retained-data window. Data at
the six-hour boundary are expired. A refresh error or rate limit may return
retained data only as `stale`. One canceled HTTP waiter does not cancel the
shared source load; it stops waiting while another request can finish and fill
the cache. No-data, disabled, rate-limit, and error states remain distinct.
The cache holds a provider `Retry-After` deadline, so later map requests do not
hammer AirNow during the cooldown. It also rejects a source-time rollback and
keeps the newer retained snapshot as stale.
Both cache storage age and trustworthy source update age must fit the six-hour
limit; fetching an already-old file does not restart its fallback life. A
no-data result also needs a trustworthy source update time because an old or
unknown file cannot prove that current records are absent.

The live fetch has a 10-second timeout and a 3 MiB cap on both declared and
streamed bytes. The nationwide file was 1,794,816 bytes on August 23, 2026, so
the cap leaves room for normal growth. It requires a valid, nonfuture upstream
`Last-Modified` for `updatedAt`; fetch time never stands in for source update
time. It rejects an empty file, invalid UTF-8, a file with no valid US primary
observations, or one with more than 5% malformed candidate rows. It does not log
the file body or coordinates and cannot fall back to fixtures. It keeps the
file in memory; there is no Cloud SQL, Firestore, Cloud Scheduler, or always-on
instance for this layer.

The provider also requires at least 500 distinct reporting areas. A normal
nationwide file had 744 on August 23, 2026. Its 5% malformed-row limit uses
only valid and malformed candidate observations, not forecast and secondary
rows that Peaks intentionally ignores. These checks reject a short file and a
file that silently loses one or more AQI categories.

## Privacy and cost

The request contains a 0.1-degree map box, not an exact user coordinate, user
ID, device ID, or Firebase token. The server rejects finer bounds before any
provider work. This route adds no application log of query values and stores
no request or AQI data. Cloud Run's normal request logs may still include the
grid-aligned request URL under the service's existing log policy.

The disabled contract and ready provider add **$0/month fixed cost** and no
upstream cost. With the toggle and server flag off by default, expected variable
cost is also about $0/month. Live use adds a small amount of request CPU and one
inbound file download per warm instance and 20-minute cache window, but no fixed
monthly service. At current
[us-central1 Cloud Run list prices](https://cloud.google.com/run/pricing), one
one-second refresh in each window costs about $0.06/month for one continuously
active instance, or about $0.33/month at the six-instance cap, before the shared
free tier. Normal Peaks traffic should keep the full added run-rate below
**$1/month**. Existing `min-instances=0`, CPU
throttling, and the six-instance cap stay unchanged. If traffic shows that the
public route can raise the backend above the $10–15/month target, add a bounded
public request
guard before enabling live data; do not buy an always-on cache.

## Deploy order

1. Merge and deploy the backend contract and live provider with
   `AIR_QUALITY_LIVE_ENABLED=false`.
2. Merge the iOS client with its toggle off and disabled/no-data/error handling.
3. Complete and record the AirNow owner notice.
4. Change the workflow pin to true in a reviewed change and deploy it.
5. Check the live public endpoint, source time, attribution, and one no-data
   viewport before turning on the client remote flag.

Do not deploy the client against live data before the backend returns the
required attribution, preliminary label, source age, and regional-precision
note.
