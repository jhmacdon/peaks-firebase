# Stretch names and curated routes

`trail-graph:compose` assigns one `display_name` to each consumed segment. It
starts with the first `trail_names` entry, then the first relation name. An
unnamed connector stays null. Each route smooths named runs shorter than 300 m
when both adjacent runs have the same name. Shared segments use the name chosen
by the most routes; ties keep the principal name, then sort by name. Each route
gets one vote per name, even if it repeats a segment.

The composer reads `seed/curated-stretches.json` from `--input`. Its `routes`
array can cover any mountain. Each rule has `route`, optional
`also_applies_to`, `approximate`, `note`, `stretches`, `points`, and `deferred`.
Each stretch has `display_name`, `kind`, `segments`, and optional `description`.
These labels override the general names for every route sharing that geometry.
Conflicting curated assignments stop composition.

A stretch may set `split_at` to a named point and `part` to `before` or `after`.
The order refers to travel on the primary route. The composer projects the
point onto the line, requires a gap of at most 150 m, inserts the projected
coordinate, and gives both pieces stable new IDs. Every route receives the same
pieces; reverse traversal reverses both their order and directions. Length and
OSM edge provenance stay with the pieces. Splitting does not add a waypoint to
routes that do not list that point.

IDs are hints. The composer also follows parent IDs after route cuts. If a build
changes IDs, it matches their old position on the previous composed geometry
within 15 m over at least 80% of each replacement's length. Keep the previous
`segments.ndjson` when rebuilding. If the old geometry is missing or cannot be
matched, composition stops and reports the unresolved hint. Kind and order alone
cannot safely distinguish adjacent glacier stretches.

Each point has `name`, `feature`, and `match` (`existing` or `new`). An existing
point must match a Peaks destination by name and compatible feature. Columbia
Crest can use Mount Rainier when no separate summit exists. A new point needs
`place_at: "end of stretch <display_name>"`. Supported features are exactly:
volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform, viewpoint,
waterfall, campsite. Points on upper DC stretches do not extend the Camp Muir
route. New points carry the source segment's credit and the curation note.

`approximate` and the notes remain in the composed row. The loader keeps them in the strict `wa_catalog` provenance object added by
`20261016_wa_catalog_activation.sql`. Route descriptions stay NULL. Canonical
rights fields still pass `is_valid_route_provenance`. Segment inserts include display name, kind,
description, a null description source URL, and state WA. Existing segments stay
insert-only in the catalog loader; its binding check rejects differing stored
metadata rather than overwriting it. The separate segment loader also inserts only and reports XY conflicts; it
never replaces existing elevation or path.

Outputs include `stretch-audit.json` (votes, conflicts, remaps, splits, deferred
points), ordered `stretches` with lengths on each route, and review `data.json`
with `sn` (ordered stretch names). The existing review HTML's embedded data is
refreshed for local-file use. Neither command fetches map tiles.

Final summit approaches can use kind `xc` only on existing OSM edges tagged
`informal=yes` or poor/no trail visibility. The composer retains those tags and
cuts at an existing vertex within the final 400 m. It never draws a line across
an unmapped gap. Summit gaps above 150 m still require review; gaps above 400 m
still need geometry. Access restrictions remain in force.

Start resolution also checks that a named access anchor lies within 3 km of the
first preferred trail. It does not use an unrelated summit or lake as a token
match for a campground. `resolution-hints.ts` records local name corrections
supported by the seed notes and source geometry. Those corrections do not change
length, preferred-name, road-share, repeat, or summit-gap thresholds. A short
route outside the named network can use a connected preferred-trail alternative
only when it improves preferred coverage and the length error.

See [the loader guide](LOAD-CATALOG.md) for deduplication and activation rules.
