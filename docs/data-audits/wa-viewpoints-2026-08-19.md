# Washington viewpoint coverage — 2026-08-19

## Scope

The source snapshot contains every named `tourism=viewpoint` OSM node, way, and
relation inside Washington. Its OSM timestamp is `2026-08-19T23:48:45Z`.

The review covered all 412 named public candidates:

- 363 included
- 47 excluded as road ends, access points, closed or private places, or other
  features tagged as viewpoints by mistake
- 2 held for more proof: Lucas Creek Former Lookout Tower and `270`

Three unnamed OSM points were added from direct hiking-source review:

- Mount Si Viewpoint below Haystack
- Mount Storm King Viewpoint
- Mount St. Helens Crater Rim (Monitor Ridge)

Dirty Harry's Balcony was already named in OSM and is part of the reviewed set.
The Mount St. Helens point has both `viewpoint` and `landform`. This is the model
for a common crater-rim turnaround. A Mount Rainier crater-rim point stays out
until a source gives a safe point for the common turnaround; the current route
endpoint alone is not enough proof.

## Reviewed result

The live dry-run planned:

- 361 new destinations
- 5 exact existing-destination enrichments
- 0 unclear destination matches
- 0 elevation gaps
- 108 new links to ended sessions with a saved path and a nearby real point

The import changes destination data only. It does not change iOS route labels or
how the app treats a route end as its top or turnaround.

## Applied result

The guarded transaction inserted all 361 rows and enriched all 5 existing rows.
The normal destination triggers created the 108 planned session links before the
script's explicit backfill ran. A second dry-run found 366 unchanged reviewed
destinations, no missing links, and no new writes.

The live Washington totals after the import are 366 viewpoint destinations and
115 viewpoint-to-session links. The four requested examples have these links:

- Dirty Harry's Balcony: 1
- Mount Si Viewpoint below Haystack: 17
- Mount Storm King Viewpoint: 1
- Mount St. Helens Crater Rim (Monitor Ridge): 19

## Review record

- OSM snapshot SHA-256: `f28d9b9bd3ea6ee4aa9dbeebd3fde993d3dd378c57e7e0d7566461a882f6ca10`
- Overpass query SHA-256: `8c6636e03bbe9cb18d8ef18cfbc1bcb1669dd46c96a84f7f1ab69f034ad9fb45`
- Review decision fingerprint: `692985a34bb9c53efff7f6a13c218e682ecbe1c87504e5ae06fde3e7fabfaac4`
- Supplement SHA-256: `1f289ecaa600dcec5b76aa7f386c0d3678a31654991983de41f0bc688df4e245`
- Planned-write fingerprint: `fefd5c45f436be156c37a6187d06249536220929eeeb8ec3dd676987090a9f6c`
- Reviewed dry-run SHA-256: `8880174a67161033e3daa0b1fae35d111f5463b4b56f81b99799733d8189ce2f`

The script adds no service, schedule, or always-on process. Monthly
infrastructure cost stays at `$0`.
