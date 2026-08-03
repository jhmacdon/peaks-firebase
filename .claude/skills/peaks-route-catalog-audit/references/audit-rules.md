# Route Audit Rules

## Stored-data gates

`audit_catalog_routes.sh` reports `identity`, `selection`, `route`, and `pair`
records for one summit.

`ERROR` blocks PASS:

- invalid, short, self-crossing, or missing path;
- missing or invalid provenance or route segments;
- route/segment source mismatch, gap, order, or materialized-path drift;
- missing or misordered trailhead and summit links;
- endpoint gaps over 300 m at the trailhead, or over 5 m at the final summit
  for out-and-back and point-to-point routes;
- any linked summit more than 5 m from the route path, or a missing path or
  summit location;
- a missing or non-canonical elevation profile; and
- missing distance or gain; and
- a legacy named-route coverage import.

`WARN` requires source or map review:

- missing shape or encoded line;
- smaller segment, endpoint, distance, or gain drift;
- point jumps or summit elevation mismatch;
- a one-way route over 25 km; and
- crossings, close overlap, weaving, duplicates, or unexplained start spread.

Different named trailheads may be valid. Repeated crossings plus long close
overlap often means two poor traces of one real trail. Render the pair before
judging it.

Loop and lollipop routes only need path contact with every linked summit. They
do not need their endpoint at a summit. `elevation_string` must exactly equal
`encode_route_elevation_profile(path)`; this proves finite nonzero Z values,
the canonical bytes, and the path vertex count. These errors require repair.
Do not waive them because an outside source looks plausible or returns HTTP
200.

## Legacy coverage fault

The retired coverage importer saved a full named OSM hiking relation when any
part came within 250 m of a summit. It marked the relation active without
proving a normal ascent, trailhead, provenance, segments, shape, or gain.

These rows have stable `osm-route-RELATION-HASH` IDs, an OSM relation external
link, no provenance or segments, no trailhead, `completion=none`, and no shape
or gain. Treat `legacy_route_coverage_import` as a known bad lineage. Preserve
historic links, but supersede the route and rebuild a real standard route
through the route factory.

## Outside-fact gates

Use at least two independent publishers. Together, the sources must prove:

- accepted normal route identity;
- real trailhead;
- distance and whether it is one-way, round trip, or loop;
- shape;
- gain when available;
- hiking, scrambling, glacier, ski, or climbing class;
- access, permit, guide, closure, and season limits.

Normalize source distance before comparison:

- out-and-back round trip: divide by two for Peaks one-way distance;
- loop or lollipop round trip: compare the whole length;
- one-way or point-to-point: compare directly.

A stored route under 0.6× or over 1.7× the sourced standard distance needs
review. Under 0.4× or over 4× is an error. No plausible active standard route
is an error. A selected default outside 0.5×–2× is an error.

## Default route

Read `cloud-sql/api/src/routes/lists.ts` each run. The current API ranks active
Peaks routes by linked session count, then one-way distance, then route ID.
That measures use, not whether the route is the normal ascent. Research the
accepted standard route whenever more than one route is active.

## Names

Treat the name as its own audit:

- `destinations.name` is the default English display name when a reliable
  English label exists.
- Preserve the official local-script name and other sourced names as localized
  names or aliases.
- Search must match the English display name, local name, and aliases.
- OSM `name`, OSM `name:*`, and Wikidata labels are evidence, not an automatic
  winner.
- Prefer a clear English Wikidata label or official English source over an
  unsourced transliteration. If English sources disagree, use `needs_human`.
- If no reliable English name exists, keep the official local name. Never
  invent a translation.

The current schema has one display field and one search field. Until localized
name columns ship, record the preferred display name, local names, and aliases
in the audit result. A repair must preserve all sourced names rather than
overwriting one with another.

## Safe actions

- `keep`: internal gates and outside facts agree.
- `repair`: the route identity is right but stored links, geometry, segments,
  stats, or names need work.
- `supersede`: the route is the wrong path or known bad legacy lineage.
- `needs human review`: sources conflict, access is unclear, or two sources
  cannot establish the normal ascent.

Never mutate route or destination data in this skill. Repair work uses a
separate reviewed task.

Use `--status catalog` for each catalog check. That scope contains active
routes plus quarantined legacy coverage rows needed as repair context.
Superseded rows do not block a pass when a sound active standard route exists.
