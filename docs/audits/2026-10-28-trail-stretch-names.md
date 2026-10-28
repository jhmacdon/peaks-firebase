# Trail stretch name audit — 28 October 2026

Scanned **19,169 catalog routes** in one read-only production snapshot: 18,621
active and 548 pending. The scan covered 252,958 route-segment links and 93,802
unique segments. It excluded superseded and private routes and imposed no region
or route limit. The snapshot hash is `5f2036c68a1d9a34e5b1f6460e3614a31e97955734fc0918144ee3c0e6d606f1`.

**4,452 routes need label review.** These are rule matches, not 4,452 confirmed
errors. A further **93 active routes have no segments or sections**, so this scan
cannot check their stretch labels. They remain explicit coverage gaps. The other
14,624 routes have no finding under these rules; that does not verify their names
against outside sources or prove their terrain types correct.

| Finding | Routes | Active routes | Unique segments |
| --- | ---: | ---: | ---: |
| `missing_segments` | 93 | 93 | 0 |
| `unnamed_ice` | 7 | 6 | 24 |
| `name_repeated_across_kinds` | 761 | 705 | 1,323 |
| `adjacent_trail_aliases` | 3,883 | 3,788 | 4,581 |
| `ice_uses_path_name` | 6 | 3 | 24 |
| `ice_named_as_trail` | 25 | 24 | 9 |
| `adjacent_name_variants` | 17 | 17 | 26 |

Counts overlap: one route may have several findings, and shared segments may
appear on many routes. The 25 routes with ice named as a trail share only nine
such segments. Those nine comprise seven glacier segments and two snowfield
segments. The broader alias check needs the most review: a shared alias can also
mean that two distinct trails overlap for part of their length.

## Three Fingers

The screenshot matches route `wa-catalog-29050878f0c18b27331bedc3`.
Its three glacier segments all use “Three Fingers summit trail”:

| Segment | Length | Saved source footprint |
| --- | ---: | --- |
| `wa-osm-d05d5f7caa8e53172405` | 60.6 m | `way/572504961`, unnamed |
| `wa-osm-25823a55845dd742faa0` | 17.1 m | `way/572504963`, unnamed |
| `wa-osm-2135eef70c65bb4e4579` | 159.0 m | `way/572504963`, unnamed |

Every edge midpoint in these stored segments falls inside the listed unnamed
footprint in the saved OSM extract. That source supports “Glacier Crossing”; it
does not supply a glacier name. The last two segments form one continuous app row
of about 578 ft. [The source check](2026-10-28-three-fingers-source-check.json)
records the IDs, lengths, and source-file hash.

The route also switches from “Three Fingers-Goat Flats-Saddle Lake Trail #641” to
“Three Fingers/ Saddle Lake” while both stretches carry the same trail alias.
That is a separate name-consistency review.

## Next repairs

1. Review the nine ice segments with trail labels and their 25 affected routes.
   Use the actual source name where supported; otherwise use a crossing label.
   Also review the 24 unnamed ice segments and the path-name matches.
2. Review the 761 routes with one name across terrain changes. Keep each terrain
   span and its distance. For one continuous named trail, a single heading with
   terrain details below it can avoid repeated titles without hiding ice or
   scramble sections.
3. Review the 3,883 routes with adjacent shared aliases and the 17 with case or
   spacing variants. Normalize only confirmed name variants; do not merge distinct
   trails merely because they share an alias.
4. Resolve the 93 routes without segments before treating their labels as checked.

The importer fix preserves polygon names, gives unnamed ice a crossing label,
and prevents smoothing across terrain changes. It applies to rebuilt manifests.
It does not rewrite existing, frozen, or reviewed production rows. No production
records changed during this task.

[Full findings](2026-10-28-trail-stretch-names.jsonl) contain one summary record,
then every flagged route with its segment IDs, ordinals, names, and terrain kinds.
[The audit command](../trail-stretch-name-audit.md) can rerun the scan or analyze a
saved snapshot. Validation: 117 focused tests, the migration TypeScript build,
strict trail-graph type checking, and repository cross-reference checks passed.
No infrastructure changes or recurring cost were added.
