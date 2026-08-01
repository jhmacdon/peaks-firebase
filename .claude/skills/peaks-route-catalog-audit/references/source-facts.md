# Source Facts

Write one compact JSON object:

```json
{
  "destination_id": "DESTINATION_ID",
  "preferred_display_name": "English display name",
  "local_names": ["Official local name"],
  "aliases": ["Other sourced name"],
  "standard_route": {
    "name": "Accepted route name",
    "aliases": ["Other sourced route name"],
    "trailhead_name": "Trailhead",
    "distance_m": 4345,
    "distance_basis": "round_trip",
    "shape": "out_and_back",
    "gain_m": 553,
    "activity": "hike",
    "access": "public park trail; check current closures"
  },
  "sources": [
    {
      "publisher": "Publisher one",
      "url": "https://example.com/route",
      "retrieved_at": "2026-08-01",
      "supports": [
        "route_identity", "trailhead", "distance", "shape", "gain", "activity"
      ]
    },
    {
      "publisher": "Publisher two",
      "url": "https://example.org/peak",
      "retrieved_at": "2026-08-01",
      "supports": ["route_identity", "trailhead", "access"]
    }
  ]
}
```

Allowed shapes are `out_and_back`, `loop`, `point_to_point`, and `lollipop`.
Allowed distance bases are `one_way` and `round_trip`.

Use meters. Record only facts the linked page supports. Publishers must be
independent. Together, the sources must support `route_identity`, `trailhead`,
`distance`, `shape`, `gain`, `activity`, and `access`. Missing proof is
`needs_human`, not a guessed value.
Use `standard_route.aliases` for sourced names of the same route. Do not use it
to make a different route pass.

If public research cannot establish every required fact or a second publisher,
write an explicit incomplete record instead of guessing or releasing the job:

```json
{
  "destination_id": "DESTINATION_ID",
  "preferred_display_name": "Best sourced display name",
  "local_names": [],
  "aliases": [],
  "standard_route": null,
  "sources": [],
  "evidence_gaps": ["no second independent public route source"]
}
```

List each exact gap. The comparator turns this into `needs_human`, or
`needs_repair` when the stored catalog already has definite internal errors.
