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

For private GPX evidence, save only summary measurements. Never save its
coordinates, filename, download URL, or contents.

## Independent review result

All eight gates must be true before `approved`.

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
    "provenance": true
  },
  "measurements": {
    "start_connector_m": 0,
    "end_connector_m": 2.1,
    "core_max_offset_m": 1.2,
    "core_p95_offset_m": 0.7,
    "core_coverage_pct": 100
  },
  "errors": []
}
```

A FAIL uses the same shape, sets failed gates false, and lists exact errors.

## Verification result

Do not write this by hand. Use `verify_standard_route.sh`; the queue reruns the
live database and public API checks before it accepts `verified`.
