# Result JSON schemas

Use one JSON object. Do not add raw source text or track points.

## Candidate result

```json
{
  "route_name": "Peak via Standard Route",
  "route_shape": "out_and_back",
  "identity_sources": [
    {"type": "official", "url": "https://example.org/route"},
    {"type": "peakbagger", "url": "https://www.peakbagger.com/climber/ascent.aspx?aid=1"}
  ],
  "identity_conflicts": [],
  "geometry": {
    "source_kind": "openstreetmap",
    "source_url": "https://www.openstreetmap.org/",
    "license": "ODbL 1.0"
  },
  "access": {"status": "open", "source_url": "https://example.org/access"},
  "comparison": {"private_reference_used": true, "max_offset_m": 4.2},
  "map_review": {"passed": true, "notes": "Correct trailhead and summit."}
}
```

When identity publishers conflict, add compact objects with `url` and `note`
to `identity_conflicts`. The URL must also appear in `identity_sources`. Never
hide a known conflict by leaving it out of the review packet.

For private GPX evidence, save only summary measurements. Never save its
coordinates, filename, download URL, or contents.

## Independent review result

All eleven gates must be true before `approved`. The example below is the
stored result. The reviewer may omit the final three machine-owned gates and
their five machine-owned measurements.

```json
{
  "verdict": "PASS",
  "reviewed_at": "2026-07-31T00:00:00Z",
  "reviewer": "peaks_route_reviewer",
  "route_id": "route-id",
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
