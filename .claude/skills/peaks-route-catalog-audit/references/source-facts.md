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
    "trailhead_aliases": ["Sourced local-language trailhead name"],
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
      ],
      "facts": {
        "route_name": "Accepted route name",
        "trailhead_name": "Trailhead",
        "distance_m": 4345,
        "distance_basis": "round_trip",
        "shape": "out_and_back",
        "gain_m": 553,
        "activity": "hike"
      }
    },
    {
      "publisher": "Publisher two",
      "url": "https://example.org/peak",
      "retrieved_at": "2026-08-01",
      "supports": ["route_identity", "trailhead", "access"],
      "facts": {
        "route_name": "Accepted route name",
        "trailhead_name": "Trailhead",
        "access": "public park trail; check current closures"
      }
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

Every source must repeat its own compact facts for the fields in `supports`.
It may omit facts it does not support. Use route and trailhead aliases for
sourced alternate or local-language names of the same route, not for a
different variant. Never combine the distance from one route variant with the
gain or shape from another. At least one source must support route identity,
trailhead, distance, shape, gain, and activity for the same route. The
comparator returns `REVIEW` when no single source supports that coherent set,
when the chosen standard route matches no such source, when any partial source
conflicts with the chosen facts, or when complete sources differ by more than
20 percent in distance or disagree on shape. The chosen access text must match
at least one source that supports access. Copy the source's access text instead
of combining or expanding it. A `point_to_point` route cannot use a
`round_trip` distance basis.
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
