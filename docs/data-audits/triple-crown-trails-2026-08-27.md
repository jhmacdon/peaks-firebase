# Triple Crown trails — 2026-08-27

Peaks imports the official main line for each U.S. hiking Triple Crown trail as
one stable route. This lets old and new recordings add partial coverage to the
same route page.

| Route ID | Trail | Display length | Geometry source | Reuse terms |
| --- | --- | ---: | --- | --- |
| `triple-crown-pct` | Pacific Crest Trail | 2,655.84 mi | [Pacific Crest Trail Association centerline](https://www.arcgis.com/home/item.html?id=71882372584549e3ab6b61fb9c1a0263) | CC BY 4.0 |
| `triple-crown-at` | Appalachian Trail | 2,197.9 mi | [National Park Service and Appalachian Trail Conservancy treadway](https://www.arcgis.com/home/item.html?id=2739a451a90c4a3283be4ccd6a6a12a9) | General reference terms; no warranty |
| `triple-crown-cdt` | Continental Divide Trail | 3,100 mi | [Continental Divide Trail Coalition centerline](https://www.arcgis.com/home/item.html?id=4ede52020cd64dd7914e436ef516ad56) | CC BY; version not stated |

The importer checks the ArcGIS item ID, owner, title, service URL, terms, route
length, and termini before it can write. It stops when those facts or the source
shape change enough to need review. The A.T. import drops a one-metre stray
fragment. The CDT import includes the four state sections marked `CDT Primary
Route` and leaves out the named alternates.

Display lengths use the groups' current published figures: [PCTA trail
data](https://www.pcta.org/discover-the-trail/maps/pct-data/), [ATC's 2026
mileage](https://appalachiantrail.org/news-stories/2026-official-mileage/), and
[CDTC maps and data](https://cdtcoalition.org/explore-the-trail/maps-and-data/).

The official files have about 0.8–1.8 million points each. Peaks keeps a server
line within 10 m of the source and adds a point at least every 100 m for route
matching. The phone line stays within 20 m and adds a point at least every 500 m.
The shown distance stays equal to each group's published 2026 length.

The guarded importer also replaces a derived, spatially indexed point set for
these three routes. This keeps per-session matching local to the saved track
while preserving the same 30 m point test and spherical distance fractions. It
does not change the write path or data for any other route.

Apply the required schema changes once:

```sh
psql -f cloud-sql/migrations/20260825_session_route_covered_intervals.sql
psql -f cloud-sql/migrations/20260827_route_area_long_lines.sql
psql -f cloud-sql/migrations/20260827_triple_crown_route_points.sql
```

Then run a read-only source check before the import:

```sh
npm --prefix cloud-sql/migrate run import:triple-crown-trails
npm --prefix cloud-sql/migrate run import:triple-crown-trails -- --apply
```

Rebuild one user's prior route coverage after the import:

```sh
npm --prefix cloud-sql/api run backfill:route-coverage -- --dry-run --user <uid>
npm --prefix cloud-sql/api run backfill:route-coverage -- --apply --user <uid>
```

The route detail API already unions these covered intervals across a user's
sessions. The iOS route detail page shows the result as miles and a percent of
the full route.

This adds no service or scheduled job. The three long trails add about 185,000
derived point rows. Even if their table and index use 60 MB, separately priced
Cloud SQL storage would cost under $0.01 per month; the current allocation should
not change its bill.
