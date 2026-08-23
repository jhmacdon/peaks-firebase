# Air-quality map API

## Readiness

The endpoint and client contract are ready, but live data is not. Production
pins `AIR_QUALITY_LIVE_ENABLED=false`. The production factory has no fixture
path and makes no network call, even if someone sets the flag to `true`.

One owner decision blocks live use: accept the [AirNow Data Exchange
Guidelines](https://docs.airnowapi.org/docs/DataUseGuidelines.pdf), complete
their contact/agreement form, and email it with a short Peaks product notice to
`dmc@airnowtech.org`, copying `white.johne@epa.gov`. Keep the sent form and any
reply. Until that step is complete, the endpoint returns a typed `disabled`
response. Do not enable it just because the public file needs no API key.

## Source and limits

The planned source is AirNow's public
[`reportingarea.dat`](https://files.airnowtech.org/airnow/today/reportingarea.dat)
file. AirNow's current [Reporting Area File Fact
Sheet](https://s3-us-west-1.amazonaws.com/files.airnowtech.org/airnow/docs/ReportingAreaFactSheet.pdf)
lists updates at :10, :25, and :40 past each hour. Observations are hourly.
Reporting areas range from part of a city to a county-sized region.
This product accepts only US state, district, and territory codes and labels
the response `coverageRegion: US` and `standard: us_epa_aqi`. An observed
reporting-area AQI is the highest AQI that the reporting agency supplied for
that area and hour. It is not an estimate at the centroid or at the user's
location.

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
reason: owner_notice_required | live_provider_not_ready |
        upstream_unavailable | upstream_invalid | null
retryAfterSeconds: number | null
```

Data and no-data responses use HTTP 200. Disabled and upstream-error responses
use 503. Rate limits use 429 and `Retry-After`. Bad viewports use 400 with an
`invalid_viewport` error. The full camel-case record shape is defined in
`cloud-sql/api/src/air-quality-reporting-area.ts`.

## Cache and failure rules

The provider seam has a process-local, single-flight cache. The live provider
should fetch the full reporting-area file once, then filter it for each
quantized viewport. Its pinned policy is a 20-minute fresh TTL, a two-hour
source-age stale threshold, and a hard six-hour retained-data window. Data at
the six-hour boundary are expired. A refresh error or rate limit may return
retained data only as `stale`. One canceled HTTP waiter does not cancel the
shared source load; it stops waiting while another request can finish and fill
the cache. No-data, disabled, rate-limit, and error states remain distinct.
Both cache storage age and trustworthy source update age must fit the six-hour
limit; fetching an already-old file does not restart its fallback life. A
no-data result also needs a trustworthy source update time because an old or
unknown file cannot prove that current records are absent.

A future live fetch must add a short timeout, a response-size cap, strict text
parsing, and a trustworthy upstream `Last-Modified` or file timestamp for
`updatedAt`. Fetch time must never stand in for source update time. Without a
trustworthy source time, data return as stale with unknown `staleAfter`. The
provider must not log the file body or fall back to fixtures. It should keep
the file in memory; there is no reason to add Cloud SQL, Firestore, Cloud
Scheduler, or an always-on instance for this layer.

## Privacy and cost

The request contains a 0.1-degree map box, not an exact user coordinate, user
ID, device ID, or Firebase token. The server rejects finer bounds before any
provider work. This route adds no application log of query values and stores
no request or AQI data. Cloud Run's normal request logs may still include the
grid-aligned request URL under the service's existing log policy.

The disabled contract adds **$0/month fixed cost** and no upstream cost. With
the toggle off by default, its expected variable cost is also about $0/month.
A live in-memory provider would add request CPU and a small inbound file
download, but no fixed monthly service. Existing `min-instances=0`, CPU
throttling, and the six-instance cap stay unchanged. If traffic shows that the
public route can raise the backend above the $10–15/month target, add a bounded
public request
guard before enabling live data; do not buy an always-on cache.

## Deploy order

1. Merge and deploy this disabled backend contract with
   `AIR_QUALITY_LIVE_ENABLED=false`.
2. Merge the iOS client with its toggle off and disabled/no-data/error handling.
3. Complete and record the AirNow owner notice.
4. Add the live file provider, size and timeout guards, cache wiring, and
   fixture-backed tests in a separate review.
5. Deploy that code while the flag stays false, run the public endpoint checks,
   then change the workflow pin to true in a reviewed change.

Do not deploy the client against live data before the backend returns the
required attribution, preliminary label, source age, and regional-precision
note.
