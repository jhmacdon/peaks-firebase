# Result JSON schemas

Use one JSON object. Do not add raw source text or track points.

## Candidate result

```json
{
  "route_name": "Peak via Standard Route",
  "route_shape": "out_and_back",
  "discovery_checks": {
    "alltrails": {
      "status": "matched",
      "url": "https://www.alltrails.com/trail/us/washington/example",
      "checked_at": "2026-08-27T12:00:00.000Z"
    },
    "peakbagger": {
      "status": "matched",
      "url": "https://www.peakbagger.com/peak.aspx?pid=1",
      "checked_at": "2026-08-27T12:00:00.000Z"
    }
  },
  "official_source_country_code": "US",
  "official_source_attempts": {
    "usfs-nfs-trails": {
      "status": "no_complete_geometry",
      "attempted_url": "https://data-usfs.hub.arcgis.com/datasets/usfs::national-forest-system-trails-feature-layer",
      "checked_at": "2026-08-27T12:00:00.000Z",
      "note": "The checked features did not form the complete route."
    },
    "nps-public-trails": {
      "status": "validation_only",
      "attempted_url": "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer",
      "checked_at": "2026-08-27T12:00:00.000Z",
      "note": "The registry allows this source for validation only."
    },
    "blm-national-public-trails": {
      "status": "validation_only",
      "attempted_url": "https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer",
      "checked_at": "2026-08-27T12:00:00.000Z",
      "note": "The registry allows this source for validation only."
    },
    "usgs-national-digital-trails": {
      "status": "no_complete_geometry",
      "attempted_url": "https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset",
      "checked_at": "2026-08-27T12:00:00.000Z",
      "note": "The USGS adapter did not return a complete route."
    }
  },
  "identity_sources": [
    {"type": "alltrails", "url": "https://www.alltrails.com/trail/us/washington/example"},
    {"type": "peakbagger", "url": "https://www.peakbagger.com/peak.aspx?pid=1"},
    {"type": "usfs-nfs-trails", "url": "https://apps.fs.usda.gov/arcx/rest/services/EDW/example"}
  ],
  "identity_conflicts": [],
  "geometry": {
    "source_kind": "openstreetmap",
    "source_url": "https://www.openstreetmap.org/",
    "license": "ODbL 1.0"
  },
  "access": {"status": "open", "source_url": "https://apps.fs.usda.gov/arcx/rest/services/EDW/example"},
  "comparison": {"private_reference_used": true, "max_offset_m": 4.2},
  "map_review": {"passed": true, "notes": "Correct trailhead and summit."}
}
```

The candidate must contain exactly the top-level keys shown. Always include
`identity_conflicts`, using `[]` when none are known. `geometry` contains only
`source_kind`, `source_url`, and `license`; `access` contains only `status` and
`source_url`; and `map_review` contains only `passed` and `notes`. The queue
stores its parsed copy and rejects extra keys such as GPX text, filenames,
coordinates, or source payloads.

For registry-backed geometry, use the exact registry ID and license name, for
example:

```json
{
  "geometry": {
    "source_kind": "usfs-nfs-trails",
    "source_url": "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where=globalid+IN+%28%27feature-1%27%29&outFields=globalid%2Ctrail_name%2Ctrail_no%2Cattributesubset%2Caccessibility_status%2Callowed_terra_use%2Chiker_pedestrian_managed%2Chiker_pedestrian_accpt%2Chiker_pedestrian_disc%2Chiker_pedestrian_accpt_disc%2Chiker_pedestrian_restricted&returnGeometry=true&returnZ=false&returnM=false&outSR=4326&f=geojson",
    "license": "U.S. Government work under 17 U.S.C. § 105"
  }
}
```

Its matching attempt must select that exact source URL:

```json
{
  "official_source_attempts": {
    "usfs-nfs-trails": {
      "status": "selected_reusable_geometry",
      "source_url": "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where=globalid+IN+%28%27feature-1%27%29&outFields=globalid%2Ctrail_name%2Ctrail_no%2Cattributesubset%2Caccessibility_status%2Callowed_terra_use%2Chiker_pedestrian_managed%2Chiker_pedestrian_accpt%2Chiker_pedestrian_disc%2Chiker_pedestrian_accpt_disc%2Chiker_pedestrian_restricted&returnGeometry=true&returnZ=false&returnM=false&outSR=4326&f=geojson",
      "checked_at": "2026-08-27T12:00:00.000Z",
      "note": "The selected features form the complete standard route."
    }
  }
}
```

Copy this URL from the candidate builder. Do not shorten or hand-edit its
stable-ID query or required ArcGIS parameters.

The shortened object above shows only the selected entry. The full candidate
must still include one entry for every registry source that covers the durable
destination country.

`discovery_checks` must contain exactly `alltrails` and `peakbagger`. A credible
direct match uses `status`, `url`, and `checked_at`, and must repeat the same URL
in `identity_sources` with the matching publisher type. AllTrails matches must
name a trail result. Peakbagger matches must name a peak, ascent, or list result;
home and search pages cannot count as matches. A `no_match` or
`unavailable` check uses `status`, `attempted_url`, `checked_at`, and `note`.
The attempted URL must be the public service search for the claimed destination
name, not another place, a result page, or the service home page. Use a current
ISO timestamp. The `candidate_ready` transition
rejects checks older than 24 hours; later review keeps that accepted timestamp
without expiring a queued candidate.
Never invent a match and never store track points.

`official_source_attempts` must contain exactly one fresh entry for every
registry source whose country list includes the destination's stored country
code. `official_source_country_code` must repeat that exact stored code, so the
saved candidate stays bound if the catalog destination later changes. A check
expires after 24 hours at `candidate_ready`. Use
`selected_reusable_geometry` only for the source that supplied the candidate,
and use its exact `geometry.source_url`. Other checks use `attempted_url` on a
host recorded for that registry source and one of these true outcomes:
`no_complete_geometry`, `not_applicable`, `validation_only`, `manual_gap`, or
`unavailable`. The queue checks each outcome against the registry status.

Try `ready_publishable` official geometry first. The existing USGS adapter is
the next geometry source and requires a completed outcome for each direct
official source. OSM is the last fallback and requires completed outcomes for
both direct official geometry and the USGS adapter. A `validation_only` or
`manual_gap` source must still have a fresh check, but cannot supply published
geometry.
If the registry has no source for the stored country, `candidate_ready` fails
until the registry records at least a reviewed `manual_gap` entry.

Keep one through four unique `identity_sources`. Use `alltrails`,
`peakbagger`, `mountaineers`, `wta`, `summitpost`, or `knps` only with that
publisher's public host. KNPS evidence must use an exact course main, course
detail, or current control-detail URL with one six-digit `parkId`. For official
evidence, use the exact source ID from the reviewed
official trail registry as the type; its URL must use a discovery or endpoint
host recorded for that same source. Generic labels such as `official`, `park`,
`government`, or `guide` do not count. Add a source to a reviewed registry or
named publisher allowlist before relying on a new publisher. At least one
source beyond AllTrails and Peakbagger is required. A disputed or
access-controlled route needs two such sources.

`access.status` must be `open`, `permit_required`, `seasonal`, or
`guide_required`. Its `source_url` must exactly match one strong entry in
`identity_sources`; AllTrails and Peakbagger cannot attest access. A KNPS access
source must be the exact `acsCtrDtl.do` control-detail URL. Its current state,
reason, effective time, and named open or closed sections must support the
claimed route; a KNPS course page or the 2016 KFS archive cannot attest access.
For comparison evidence, use exactly `{"private_reference_used":false}` when no
private track was checked. When one was checked, add only `max_offset_m` as a
finite non-negative number. Never add a filename, download URL, or coordinates.
Keep one through four unique identity sources. The reviewer sees every saved
entry, so do not include a source that was not checked or omit a known source
to make the evidence look stronger.

When identity publishers conflict, add compact objects with `url` and `note`
to `identity_conflicts`. The URL must also appear in `identity_sources`. Never
hide a known conflict by leaving it out of the review packet. Two entries is
the limit; a larger dispute needs human review before candidate import.

For private GPX evidence, save only summary measurements. Never save its
coordinates, filename, download URL, or contents.
When no private reference was used, write only
`{"private_reference_used": false}`. When one was used, `max_offset_m` must be
a finite number from 0 through 1,000,000. The packet builder applies the fixed
50 m pass limit and gives the reviewer the result. A failed comparison makes
the route-identity gate fail; a missing comparison never counts as proof.

## Independent review result

All eleven gates must be true before `approved`. The example below is the
stored result. The reviewer may omit the final three machine-owned gates and
their five machine-owned measurements.

```json
{
  "verdict": "PASS",
  "reviewed_at": "2026-07-31T00:00:00Z",
  "reviewer": "luna-route-reviewer-01",
  "destination_id": "destination-id",
  "route_id": "route-id",
  "reviewer_id": "luna-route-reviewer-01",
  "candidate_sha256": "durable-candidate-sha256",
  "candidate_result_sha256": "candidate-result-sha256",
  "source_check_sha256": "source-check-sha256",
  "review_packet_sha256": "review-packet-sha256",
  "source_check": "osm",
  "gates": {
    "route_identity": true,
    "geometry_rights": true,
    "access": true,
    "map_review": true,
    "source_geometry": true,
    "pending_route": true,
    "endpoints": true,
    "provenance": true,
    "summit_contact": true,
    "elevation_profile": true,
    "segment_assembly": true
  },
  "measurements": {
    "start_connector_m": 0,
    "end_connector_m": 2.1,
    "core_max_offset_m": 1.2,
    "core_p95_offset_m": 0.7,
    "core_coverage_pct": 100,
    "summit_max_gap_m": 2.1,
    "profile_point_count": 241,
    "path_point_count": 241,
    "segment_count": 1,
    "matching_assembly_point_count": 241
  },
  "errors": []
}
```

A FAIL uses the same shape, sets failed gates false, and lists exact errors.
`source_check` is `osm`, `usgs`, or `official` and must match the independent
checker that produced the packet.
The reviewer copies every destination, route, reviewer ID, and checksum binding
from the packet template without change. The queue verifies them against the
stored candidate, packet, and locked review lease before it accepts either PASS
or FAIL. The packet template does not supply the top-level `reviewer`; the queue
writes that stored field from the fresh lease owner.

Do not guess or hand-write the last three gate values or their five count-only
measurements. The `pending_review -> approved` queue transition runs
`peaks_route_passes_publish_integrity(route_id, destination_id, 'pending')`
inside the leased database transaction. It replaces those values with fresh
database results before it validates and stores the review. A false machine
result rejects approval even when the review JSON says `PASS`.

## Verification result

Do not write this by hand. Use `verify_standard_route.sh`; the queue reruns the
live database and public API checks before it accepts `verified`.

The verifier requires `summit_contact` and `elevation_profile` as well as the
owner, active status, destination order, segment assembly, provenance, and
public HTTP gates. Its payload contains counts, gaps, and the encoded profile,
but never route coordinates.
