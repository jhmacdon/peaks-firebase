# Dirty Harry's Balcony pin

The legacy destination `hYq0TiVHKb5zFQsm519H` sat at
47.434126, -121.61243, about 170 m west of the viewpoint. Those coordinates
match [Peakbagger's entry](https://peakbagger.com/peak.aspx?pid=33974).

[OpenStreetMap node 1733479723](https://www.openstreetmap.org/node/1733479723)
(version 6, checked September 28, 2026) places the balcony at
**47.4337029, -121.6102647**. Peaks already had that point as the duplicate
`2EF77C90D623341371D5`, with a Terrarium elevation of 769.43359375 m.
The owner's September 27 track supports the OSM location: 206 recorded points
fall within 20 m of it, versus zero within 20 m of the legacy point. The
closest track point is under 1 m from OSM and about 24 m from the legacy pin.
The centroid of all points within 300 m includes the approach trail, so it
does not give a better viewpoint location.

The repair keeps the legacy ID because it holds two session links, a route,
a trip report, a session comparison, and route maintenance records. The
duplicate has one session link, already present on the keeper with the same
relation and source. It has no other foreign-key references. The repair checks
these conditions again under row locks and aborts if they change.

The keeper receives the OSM point, its matching elevation, corrected geohash,
display name, state/country, OSM ID, and source credit. It retains its summit
classification and gains the viewpoint tag. Existing links and popularity
data stay on that ID. The OSM importer checks `external_ids.osm_node`, so a
later import can match the retained record. The repair removes the duplicate
and touches linked sessions so clients can refresh their embedded destination.
It does not alter route geometry or recorded GPS points.

## Run

The SQL lives in
[`cloud-sql/migrate/repairs/20260928_dirty_harrys_balcony.sql`](../../cloud-sql/migrate/repairs/20260928_dirty_harrys_balcony.sql).
It is an explicit data repair, outside the schema migration runner. Use the
usual Cloud SQL proxy and database credentials; do not put passwords in files.

For a preview, execute `BEGIN`, the file, inspect both destination IDs and their
links, then `ROLLBACK`. To apply, execute the file with `psql -v ON_ERROR_STOP=1`.
The single `DO` statement commits all changes together or rolls back on error.
A repeat run returns without changing an already corrected record.

The repair adds no infrastructure or recurring cost ($0/month).

## Verification

Applied on September 28, 2026 at 18:26 UTC. A read after commit confirmed one
record at the OSM coordinates, with the original ID and both session links
(one manual and one automatic). Every existing foreign-key row on the keeper
survived unchanged, including the route, report, and comparison.

The focused `dirty-harrys-balcony.test.ts` check passed in `peaks_test` using
temporary tables and a rollback. It covers the corrected point and elevation,
link preservation, repeat runs, and refusal when new references, conflicting
session links, changed identities, or new content appear. A preview against
the production rows also passed and rolled back before the apply.
