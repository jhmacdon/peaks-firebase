# Standard route batch — 2026-07-27

This batch adds 30 Peaks-owned standard routes: 10 in Washington and 20 in
Colorado. Route identity comes from the written sources in
`standard-routes-2026-07-27.json`. Geometry comes from the exact current
OpenStreetMap ways stored in that manifest and in each GeoJSON candidate.

## Production result

Imported into Cloud SQL and activated on 2026-07-28:

| Candidate | Route id |
|---|---|
| `hibox-mountain` | `kH4QvfzqJegyIujpBM91` |
| `guye-peak` | `epgdnc8lYzgnnFClLfRd` |
| `fay-peak` | `ETQt5AEkpobrbyrTTcHU` |
| `ingalls-peak` | `aXEHeJetvshw8lnmHEZD` |
| `little-annapurna` | `1bn9SqLxHJk7amo5AXiJ` |
| `liberty-bell-mountain` | `zYHspkOC6KLTrYLQvQP6` |
| `mount-sneffels` | `pzRqWReJuBwwSzKCiBJ2` |
| `ruth-mountain` | `JHEVAQzKKkHDe6Jsm7Gq` |
| `mount-hinman` | `kG03P8ClfUZ1AVbCOtot` |
| `mount-stuart` | `wCtFia9bHjfOnGeXeyEQ` |
| `old-snowy-mountain` | `s29qYa95eSjIMPyWlJqj` |
| `mount-antero` | `o1kMfPBKqor10Hnf770A` |
| `castle-peak` | `AZnU4Q39GxaUirrn4q00` |
| `crestone-peak` | `bcpP6vLDV4PoJwRm5nJe` |
| `crestone-needle` | `1OLZhsVoYhFbYEBcbVxt` |
| `sunlight-peak` | `AGkZ6h6xFZUS6V9W5fqX` |
| `mount-eolus` | `oK2MT520PGsYcrzgxS9r` |
| `windom-peak` | `0OPjPHcFRmhIeT1Mpde3` |
| `uncompahgre-peak` | `xHrMaM1V0lj3WO5KFyDt` |
| `handies-peak` | `nQQbyezbfEmxTPIYfBDt` |
| `blanca-peak` | `K6JhVNOjOeKgmR4OadYM` |
| `ellingwood-point` | `OHUG1HItlxWOM1xwL1ia` |
| `little-bear-peak` | `0iWVb0IMW9RaFCErmLqh` |
| `wilson-peak` | `aApq8w7nEp9XzmYhTnOK` |
| `mount-wilson` | `GIBwCGCF20nGQIDglXMP` |
| `mount-of-the-holy-cross` | `D5u6tuC6yXvTLA19Yaq0` |
| `redcloud-peak` | `ltCHOEQZqLHnPk01oYFM` |
| `challenger-point` | `o8kLwn8clMQzwHQPWbUk` |
| `kit-carson-peak` | `xyTzJln8AcUdgyYMk4PK` |
| `mount-lindsey` | `myxijYXcUaFAORDERHCo` |

The import check found:

- 30 manifest routes, 30 pending Cloud SQL routes
- 30 source segments and 60 ordered destination links
- matching valid route and segment provenance for every route
- non-empty exact OSM way lists and all written source links
- route endpoints on their catalog trailhead and summit records
- no rows or orphan segments left from rejected candidates

Fourteen Colorado trailheads needed by the batch were added by
`20260727_colorado_standard_route_trailheads.sql`.

## Review evidence

All 30 candidates passed the importer's dry-run checks. Static maps rendered
over public OSM tiles were reviewed before import.

The independent current-OSM checker passed all 30 pending routes:

- 100% of core samples were within 3 m of cited OSM geometry
- rounded core maximum and p95 offsets were 0.00 m
- every cited OSM way contributed to its stored route
- endpoint connectors were within the 125 m approval limit
- no current OSM pedestrian-access tag blocked a route

Mount Angeles and Tomyhoi Peak first failed that connector gate at 143.1 m and
150.1 m. They were replaced by Guye Peak and Mount Sneffels. Their two pending
route rows and two unshared segment rows were removed.

The publication pass then found:

- 30 active Peaks routes with valid OSM route provenance
- 60 ordered destination links and no orphan segments
- 50 segment links across 41 segments
- 9 shared segments used by 14 routes in this batch
- unchanged materialized route geometry, stats, destination links, and provenance
- a maximum 35.1 m segment join across the 30 routes and the two older routes
  whose segment graphs changed, within the matcher's 60 m bridged-gap limit

One Guye Peak segment reuses a legacy Snoqualmie Mountain segment that has no
stored segment provenance. Guye Peak's route-level OSM provenance remains
complete and is what the public attribution surfaces show. The legacy segment
stays source-null rather than being given a false OSM source.

## Cost

This is data and migration tooling only. It adds no service, scheduled job,
minimum instance, or always-on CPU. The run-rate change is $0/month apart from
small Cloud SQL storage growth.
