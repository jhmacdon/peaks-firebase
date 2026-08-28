# Official trail source registry

Reviewed: 2026-08-27

The registry at `data/official-trail-sources.json` records official trail geometry that can check route ideas found through AllTrails, Peakbagger, guidebooks, or local knowledge. Discovery sources can suggest a route. They do not grant Peaks the right to copy geometry. Published geometry must come from an approved official source and keep its exact feature IDs, retrieval URL, retrieval date, authority, license, and attribution.

The TypeScript loader validates every field at start-up. It rejects unknown keys, duplicate IDs, unsafe URLs and field names, missing limits, unreviewed dates, and any attempt to make a source publishable without a code allowlist change. This is deliberate: adding an open-data link is not enough to approve a publisher.

## Status meanings

- `ready_publishable`: the service, stable ID, access fields, reuse right, and attribution have been reviewed and the generic ArcGIS route tools may publish selected geometry.
- `validation_only`: official data can confirm route identity or alignment, but its adapter, schema, access meaning, attribution, rate limits, or product rights still need work. Never copy its geometry into a published route through the generic adapter.
- `manual_gap`: no stable machine-readable route layer with clear reuse terms was confirmed. Use the official page only for manual checks and agency outreach.

Only one source is publishable:

| ID | Jurisdiction | Query endpoint | Rights |
| --- | --- | --- | --- |
| `usfs-nfs-trails` | U.S. National Forest System | [USFS layer query](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query) | [17 U.S.C. § 105](https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm); credit `USDA Forest Service` |

NPS Public Trails remains `validation_only` because `OPENTOPUBLIC` is unpopulated in the live layer and the former positive access rule matched no records. USGS National Digital Trails also remains a `validation_only` entry with `existingAdapter: usgs-national-digital-trails`. Keep USGS on its current import path; do not route either source through the generic ArcGIS publisher.

## Access checks

Each publishable adapter has an `accessPolicy` in the registry. The loader checks that every rule uses a fetched `service.accessFields` field. The candidate builder applies every rule to each selected official feature. The pending-route checker fetches those features again and applies the same rules. A missing positive field, a new value outside an allowlist, or a failed rule rejects the route.

- USFS features must use `TrailNFS_MGMT`, the `allowed_terra_use` value must match the reviewed agency code set that includes `1` for hiker or pedestrian use, and the hiker restriction and discouraged-use fields must not cover `01/01-12/31`. Unknown codes, Basic or centerline-only records, and all-year discouraged records fail.

NPS needs a populated, source-specific public hiking access signal and live fixtures before it can become publishable. Park alerts, closures, permits, and superintendent notices still take priority.

The USFS code allowlist records every distinct `allowed_terra_use` value that included pedestrian code `1` in the live management layer on the review date. A new code fails until someone checks it against the agency schema and updates the registry.

These checks prove that the source record is suitable for a hiking route; they do not prove that it is open today. Seasonal limits, emergency closures, permits, and local orders still need a current land-manager check.

## Catalog coverage

The JSON file is the source of truth for exact discovery, service, download, and license URLs. It also records coverage and source-specific limits.

| Status | Sources |
| --- | --- |
| `ready_publishable` | USFS National Forest System Trails |
| `validation_only` | NPS Public Trails; USGS National Digital Trails; BLM National Public Trails; Parks Canada Trails; British Columbia Recreation Lines; Alberta Designated and Provincial Trails; Ontario Trail Network; Sépaq Summer Trails; deprecated New Zealand DOC Tracks; New South Wales NPWS Track Sections; Victoria Recreation Tracks; Queensland QPWS Access; Tasmania LIST Tracks; Western Australia Long Trails; Norway Turrutebasen; Swedish protected-area and state mountain trails; Finland Topographic Database; swissTLM3D hiking trails; France BD TOPO; Spain CNIG park routes; Natural England National Trails; Scotland Core Paths; Natural Resources Wales recreation routes; Ireland National Trails Register; Bavarian hiking routes; Austria GIP and Alpine paths; Slovenia maPZS mountain trails; Croatia GeoHrvatska hiking trails; Sentiero Italia CAI; Czechia ZABAGED marked hiking routes; Poland BDOT10k foot and cycle paths; Costa Rica SINAC Chirripó trails; Colombia National Parks ecotourism trails; Iceland IS 50V; Taiwan Tourism trails; Hong Kong AFCD country-park trails; South Korea hiking roads; Japan Ministry of the Environment Tokai Nature Trail GPX |
| `manual_gap` | Mainland China official route data; Himalayan official route data in Nepal, India, Pakistan, and Bhutan; Japan long-distance nature trails outside the Tokai package; CapeNature FORGE maps; South African National Parks trails; Peru SERNANP GEO ANP; Brazil ICMBio geodata; Argentina National Parks hiking references; Chile CONAF territorial viewer; Mexico CONANP; Northern Ireland rights of way; Portugal Natural.PTrails; Greece NECCA national trail register; Türkiye DKMP EKOTABAN routes; Iran official mountain routes; Kazakhstan state tourist-route register; Georgia protected-area trails; Russia federal protected-area routes; Kenya Wildlife Service mountain routes; TANAPA Kilimanjaro routes; Uganda Wildlife Authority Rwenzori routes; Indonesia national-park route notices; Philippines Protected Area Information System; Antarctica official climbing routes |

This registry has 63 reviewed records across 51 country codes: 1 publishable source, 38 validation sources, and 24 recorded gaps. It is a maintained seed catalog, not a claim of full global coverage. Large gaps remain in Central and South Asia, much of Latin America and Africa, parts of central and southern Europe, and park systems that publish only PDFs or interactive maps. Add a `manual_gap` record when an official agency has useful route guidance but no reusable machine layer. Replace that gap with a separate source record when a stable machine layer and its exact terms are confirmed. Do not fill a gap with crowdsourced geometry under an official source label.

Some catalog records need extra care. DOC marks the recorded New Zealand service as deprecated and no longer maintained, so it can help with historical alignment only until DOC publishes its replacement. Parks Canada's current public service is transitional and lacks a durable feature ID. Attribution templates for Finland, France, and Natural England that contain `[year]` or `[delivery month/year]` must use the route source's real retrieval or delivery date; never freeze the registry review date into the published credit.

## Route workflow

1. Use AllTrails and Peakbagger to learn the usual trailhead, route name, variants, and likely corridor. Treat their geometry as discovery material unless separate terms grant reuse.
2. Check every registry source that covers the destination's stored country code. Save that code in `official_source_country_code` and exactly one fresh, registry-compatible result for each source in `official_source_attempts`, even when it is not applicable, validation-only, a manual gap, or unavailable. A later country-code change invalidates the saved candidate.
3. Try `ready_publishable` official geometry first. Select its exact source URL when its linework forms the complete route and the trailhead and summit connectors pass the route geometry checks.
4. If direct official geometry has no complete route, try the existing USGS adapter. Use OSM only after both direct official geometry and USGS have durable negative outcomes.
5. Review current land-manager closures, permits, hazards, and alerts. Registry geometry is not a live safety feed.
6. Store the selected source URL, feature or object IDs, license, credit, retrieval date, and matching route-segment provenance. A `validation_only` or `manual_gap` registry source never supplies published geometry.

## Approving another adapter

Before moving a source to `ready_publishable`:

1. Confirm the endpoint with the publishing agency and save a representative response fixture.
2. Pick a stable, populated feature ID and test name and access fields against real features.
3. Confirm commercial and derivative reuse, exact credit text, and any share-alike, no-endorsement, or rate-limit term.
4. Write source-specific filters that reject closed, private, restricted, non-hiking, missing, or unclear access records.
5. Add parser and route-builder tests, then add the source ID to `READY_ARCGIS_IDS` in `official-trail-sources.ts`.
6. Update `reviewedAt` for the whole registry after every entry has been checked again.

Do not treat a CC license on a catalog page as proof that every linked resource has that license. Do not use a map tile, screenshot, or interactive viewer as route geometry unless its terms expressly allow reuse.
