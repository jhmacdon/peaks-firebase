# Rainier glacier API and runbook

This backend adds 29 destination regions: 28 named OSM glaciers and Muir Snowfield.
All have `features: ["glacier"]`; `glacier.kind` distinguishes `glacier` from
`snowfield`. They remain destinations for saving, search and place links. They
are not protected areas or route objectives inferred from geometry.

## Client capability and access

Send this header on **every** glacier-aware request, including search and sync:

```http
X-Peaks-Capabilities: glaciers-v1
Authorization: Bearer <Firebase ID token>
```

The authorization header is optional on public catalog GETs. An invalid token
still fails authentication. Personal sessions and `/sessions/:id/route-facts`
require sign-in, with the existing owner/public-session access rule.

The shipping iOS `peakscore/PeaksModels/Destination.swift` skips unknown features
when reading archives, and `DestinationRepo` tolerates unknown API features.
Its `DestinationBoundary.parseCoordinates`, however, accepts only Polygon.
It drops MultiPolygon boundaries. There is no explicit client version header in
`PeaksAPI`. Thus this change uses an opt-in capability rather than guessing a
minimum app version from User-Agent. Responses vary on `X-Peaks-Capabilities`.
Without that capability, search/nearby/viewport exclude glaciers before their
limits; nested destination arrays omit them, glacier detail returns 404, and
new glacier facts/crossing fields are absent. Existing lake boundaries keep their
current shape and behavior.

If the engine migrations are absent, capable route/session readers send
`glacier_crossings: []` and `glacier_crossings_status: "unavailable"`.
The full glacier endpoint and an explicit glacier feature search return 503 with
`{"error":"Glacier migration not installed"}`. Schema checks expire after one
minute. No reader tries a legacy datastore or repairs data during a GET.

## Endpoints

| Method and path under `/api` | Change |
| --- | --- |
| `GET /search?q=&lat=&lng=&limit=` | Capable callers use `destination_search_rows`; glaciers are ordinary destination hits. |
| `GET /search/all?q=&lat=&lng=&limit=` | Glaciers appear in `destinations` and ranked `results` as type `destination`. Crossing glacier names also supply route terms, weighted 0.8. |
| `GET /search/features?features=glacier&activities=outdoor-trek&lat=&lng=&radius=&limit=` | Existing filters accept `glacier`. |
| `GET /destinations/nearby?lat=&lng=&radius=&limit=` | Includes glacier destination summaries for capable callers. |
| `GET /destinations/viewport?minLat=&maxLat=&minLng=&maxLng=&limit=` | Includes glacier summaries by representative point, as for other destinations. |
| `GET /destinations/:id` | Existing destination detail plus `glacier` for a glacier destination. |
| `GET /destinations/:id/glacier?session_limit=25&session_offset=0` | New full place sheet, shaped like area detail; example below. Public catalog access is allowed. |
| `GET /destinations/:id/routes` | For capable callers, includes active, accessible routes with stored crossings, in addition to existing explicit route links. Distinct routes only. Existing route summary JSON remains unchanged. |
| `GET /routes/:id` | Adds `glacier_crossings` and `glacier_crossings_status`. |
| `GET /routes/:id/landmarks?cursor=` | Keeps `{items,nextCursor,distanceThroughMeters}`; adds those same two fields, independently of paged point landmarks. |
| `GET /sessions/:id` | Adds track-derived `glacier_crossings` and `glacier_crossings_status`, independent of a primary route. |
| `GET /sessions/:id/route-facts` | New compact `{session_id,segments,glacier_crossings,glacier_crossings_status}`. `segments` retains the existing primary-route contract; glacier spans do not depend on it. |
| `POST /sessions/:id/destinations` | Existing `rejected` / `unreject` lists also govern glacier crossings. No body change. A rejection hides/deletes derived spans at once; unreject queues a fresh match. Manual reaches do not invent spans. |
| `GET /sessions/changes` | Existing sync envelope stays unchanged. Changed crossings touch the session's sync timestamp. Fetch detail/route-facts after an upsert; omitted crossing fields in list/sync rows do not mean deletion. |

`Interglacier` normalizes to `inter glacier`; the importer also records that alias
in destination metadata. Search keeps the October word-candidate cap, trigram
indexes and function costs. It does not join boundary geometry or crossing tables
when scoring destination candidates. Full rows load after the shortlist.

A search destination summary looks like this; optional existing scores and area
summaries follow the endpoint's current contract:

```json
{
  "id": "B5B5E8E3D1BFB7A3126D",
  "name": "Emmons Glacier",
  "type": "region",
  "features": ["glacier"],
  "activities": ["outdoor-trek", "ski"],
  "elevation": null,
  "prominence": null,
  "country_code": "US",
  "state_code": "WA",
  "lat": 46.88,
  "lng": -121.72,
  "areas": []
}
```

The example coordinate is illustrative. The representative pin has no measured
elevation; do not treat its legacy PointZ padding as a glacier height. Fetch detail for the stored display
boundary and checked parent identity; do not infer an extent from the pin.

## Glacier detail and facts

`GET /destinations/:id/glacier` returns a flat area-like object. IDs in angle
brackets below stand for existing catalog IDs; crossing and session examples are
illustrative, not claims about a user's recordings. No production rows were read.

```json
{
  "id": "B5B5E8E3D1BFB7A3126D",
  "name": "Emmons Glacier",
  "type": "region",
  "features": ["glacier"],
  "activities": ["outdoor-trek", "ski"],
  "owner": "peaks",
  "kind": "glacier",
  "country_code": "US",
  "state_code": "WA",
  "lat": 46.88,
  "lng": -121.72,
  "bbox_min_lat": 46.85,
  "bbox_max_lat": 46.92,
  "bbox_min_lng": -121.77,
  "bbox_max_lng": -121.70,
  "boundary": {
    "type": "MultiPolygon",
    "coordinates": [[[
      [-121.75,46.87],[-121.74,46.87],[-121.74,46.88],[-121.75,46.87]
    ]]]
  },
  "description": "Emmons Glacier descends from Mount Rainier’s northeast side into the White River Valley. Rock debris from a 1963 rockfall off Little Tahoma covers much of its lower surface.",
  "description_source_name": "National Park Service",
  "description_source_url": "https://www.nps.gov/places/emmons-glacier.htm",
  "description_source_license": "U.S. Government work",
  "geometry_credit": "© OpenStreetMap contributors",
  "parent_mountain": {"id":"<rainier-id>","name":"Mount Rainier"},
  "glacier": {
    "kind": "glacier",
    "nps_name": "Emmons",
    "observed_year": 2021,
    "area_km2": 10.959203,
    "area_uncertainty_km2": 0.575333,
    "head_elevation_m": 4312,
    "terminus_elevation_m": 1488,
    "elevation_range_m": 2824,
    "length_km": 7.32,
    "average_slope_deg": 24,
    "flow_direction_deg": 55,
    "flow_direction_label": "NE",
    "type_code": "S",
    "type_label": "Glacier Head Near Summit",
    "estimated_volume_km3": 0.659213186,
    "volume_uncertainty_km3": 0.230724615,
    "rank_on_mountain": 1,
    "area_history": [
      {"year":1896,"area_km2":17.458,"uncertainty_km2":0.907},
      {"year":1913,"area_km2":12.622,"uncertainty_km2":0.660},
      {"year":1971,"area_km2":11.158,"uncertainty_km2":0.586},
      {"year":1994,"area_km2":11.223,"uncertainty_km2":0.589},
      {"year":2009,"area_km2":10.979,"uncertainty_km2":0.576},
      {"year":2015,"area_km2":11.027,"uncertainty_km2":0.579},
      {"year":2021,"area_km2":10.959,"uncertainty_km2":0.575}
    ],
    "area_history_scope": "Emmons",
    "percent_change_since_earliest": -37.2264864245618,
    "outline_observed_at": "2026-10-28",
    "outline_source_url": "https://www.openstreetmap.org/relation/5535843",
    "outline_source_sha256": "02cea8bc617563b180036921c7114b56e0234c359a0af174cf24becc37cf5cb0",
    "outline_revision": 1,
    "geometry_credit": "© OpenStreetMap contributors",
    "geometry_license": "ODbL-1.0",
    "facts_credit": "Beason et al. (2023), National Park Service",
    "facts_source_url": "https://doi.org/10.36967/2299328",
    "parent_mountain": {"id":"<rainier-id>","name":"Mount Rainier"},
    "mountain_context": {
      "observed_year":2021,"named_glacier_count":28,"area_km2":75.496,
      "area_uncertainty_km2":4.109,"percent_change_since_1896":-41.6
    },
    "description": "Emmons Glacier descends from Mount Rainier’s northeast side into the White River Valley. Rock debris from a 1963 rockfall off Little Tahoma covers much of its lower surface.",
    "description_credit": "National Park Service",
    "description_source_url": "https://www.nps.gov/places/emmons-glacier.htm",
    "provenance": {
      "report": {
        "doi":"10.36967/2299328","url":"https://doi.org/10.36967/2299328",
        "credit":"Beason et al. (2023), National Park Service",
        "license":"U.S. Government work","observed_year":2021
      },
      "tables": {
        "area":"4, p.17 (m² converted to km²)",
        "topography":"5, pp.20–21 (SI columns; integer mean slope)",
        "history":"7, pp.25–26 (published km²; grouped names retained)",
        "volume":"12, pp.38–39 (m³ converted to km³; statistical estimate)"
      },
      "type_source_url":"https://www.nps.gov/places/emmons-glacier.htm",
      "history_scope":"Emmons",
      "percent_method":"100 * (last / first - 1), first non-null year, Table 7 scope",
      "note":null,
      "report_sha256":"<report-sha256>",
      "source_snapshot_sha256":"02cea8bc617563b180036921c7114b56e0234c359a0af174cf24becc37cf5cb0",
      "mountain_context": {
        "observed_year":2021,"named_glacier_count":28,"area_km2":75.496,
        "area_uncertainty_km2":4.109,"percent_change_since_1896":-41.6
      }
    }
  },
  "destination_count": 0,
  "destinations": [],
  "route_count": 0,
  "routes": [],
  "session_count": 0,
  "latest_session_at": null,
  "session_distance": 0,
  "session_gain": 0,
  "session_time": 0,
  "sessions": [],
  "sessions_has_more": false,
  "sessions_next_offset": 25
}
```

All physical measurements are JSON numbers or null, never numeric strings or
placeholder zeroes. The area and volume use the report's m²/m³ values converted
to km²/km³; history retains its published rounded km². Slope uses Table 5's
integer mean. Flow bearing means the direction ice flows **towards**, clockwise
from north; it is not a separately measured aspect. Type codes exist only where
the saved NPS glacier page states them (`S` near summit; `C` cirque/head below
summit). Missing codes remain null. Volume is a statistical estimate, not a survey.

`outline_observed_at` is the **OSM snapshot date**, not a claim that the outline
was surveyed that day. Physical facts describe 2021. Every historic route/session
uses this same OSM snapshot; these are not date-matched historic ice extents.
The exact MultiPolygon keeps all components and holes. Display uses a stored,
topology-preserving two-metre simplification in UTM zone 10N, served as GeoJSON
`[longitude,latitude]`. Never reduce a MultiPolygon to its largest ring. A null
display boundary indicates missing derived data; the API does not simplify on read.

The `glacier` object on `/destinations/:id` is identical. The destination's
existing global session counts on that older endpoint keep their old meaning;
use the full glacier endpoint for **personal** activity.

`session_count` and activity totals count the signed-in user's distinct crossing
sessions, once each even when there are several passes. Totals describe those
whole activities, not time/distance spent on ice. Signed-out callers get no
sessions, zero personal totals and a null latest date. Rejected or pending matches
do not count. `session_limit` clamps to 1–50, default 25; `session_offset` defaults
to zero and caps at 1,000,000. `sessions_next_offset` is offset + limit.

Each session summary contains `id,user_id,name,start_time,end_time,distance,gain,
total_time,activity_type,high_point,ascent_time,descent_time,still_time,
processing_state,group_id,ended,is_public,updated_at,server_updated_at,path_preview`
and `glacier_crossings`. The latter is a small list for this glacier only, with
`pass_index,entered_at,exited_at,entered_distance_m,exited_distance_m,
min_elevation_m,max_elevation_m`. Timestamps are ISO 8601 or null. Preview paths
are the existing small GeoJSON LineStrings.

`route_count` counts distinct active routes the caller can read. The full sheet
returns at most 15, sorted by popularity then name/id. Each has
`id,name,owner,polyline6,distance,gain,gain_loss,elevation_string,external_links,
provenance,completion,shape,kind,slug,difficulty,terrain_category,
est_moving_seconds,popularity` and the existing flat `cover_destination_id,
cover_destination_name,cover_image,cover_image_attribution,
cover_image_attribution_url,cover_image_focal_x,cover_image_focal_y,
cover_image_origin` fields. `/destinations/:id/routes` returns the full accessible
route list with its existing richer route summaries.

## Source crosswalk and limits

| OSM name | Facts handling |
| --- | --- |
| Inter Glacier | NPS `Inter`; `Interglacier` is a search alias. |
| Pyramid Glaciers | NPS `Pyramid`. |
| Sarvant Glacier | NPS spelling `Sarvent`. |
| Paradise Glacier | Individual 2021 facts; Table 7 history is `Paradise-Stevens`. Stevens left the glacier inventory in 2021. |
| Cowlitz / Ingraham | Individual headline facts; Table 7 combines `Cowlitz-Ingraham`. |
| Kautz / Success | Individual headline facts; Table 7 combines `Kautz-Success`. |
| Nisqually / Wilson | Individual headline facts; Table 7 combines `Nisqually-Wilson`. |
| Muir Snowfield | Separate from NPS **Muir Glacier**. Kind snowfield; no NPS glacier facts assigned. |
| Pinnacle Glacier | OSM glacier with no matched individual report row; headline facts null. |

Render `area_history_scope` with the chart and percentage. Combined histories
must not be labeled as the individual glacier's area loss. Missing 1896 entries
for Flett/Ohanapecosh/Sarvent stay null; percent change starts at the earliest
non-null observation. The mountain-wide count of 28 is the **NPS inventory**,
which includes Muir Glacier; it is not the roster of 28 OSM glacier objects.

Eight saved NPS files support short glacier copy and type codes. The saved
`paradise.txt` and `ohanapecosh.txt` describe visitor areas, so they supply no
glacier description. The importer does not borrow their text. Other descriptions
and type codes remain null. Geometry credit is
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under
ODbL. Facts credit is
[Beason et al. (2023), National Park Service](https://doi.org/10.36967/2299328).
The NPS 2021 shapefile is not an input.

## Crossing shape and semantics

A route or session detail adds:

```json
{
  "glacier_crossings_status": "complete",
  "glacier_crossings": [{
    "destination_id": "B5B5E8E3D1BFB7A3126D",
    "name": "Emmons Glacier",
    "kind": "glacier",
    "pass_index": 0,
    "segment_number": 2,
    "entered_distance_m": 2300.5,
    "exited_distance_m": 5100.25,
    "crossed_distance_m": 2799.75,
    "entered_at": "2026-08-01T08:10:00.000Z",
    "exited_at": "2026-08-01T10:00:00.000Z",
    "entry_elevation_m": 2600,
    "exit_elevation_m": 3400,
    "min_elevation_m": 2590,
    "max_elevation_m": 3420,
    "starts_inside": false,
    "ends_inside": false,
    "entry_location": {"type":"Point","coordinates":[-121.72,46.88]},
    "exit_location": {"type":"Point","coordinates":[-121.75,46.86]},
    "outline_observed_at": "2026-10-28",
    "outline_revision": 1,
    "matcher_version": 1,
    "geometry_credit": "© OpenStreetMap contributors"
  }]
}
```

`complete` with `[]` means the match ran and found no positive span. `pending`
with `[]` means no current result exists; reload after processing. `unavailable`
means schema support is absent. A failed canonical session process retains its
existing `processing_state` / `processing_error`; no fabricated empty completion
replaces it. Route times are null and `segment_number` is zero. Session segment
numbers are the saved recording segment, not a route segment ID.

Spans sort by entry distance, glacier ID and pass index. Pass indices start at
zero **per glacier per route/session**; keep separate return passes and multipart
visits. Stable client identities can be `glacier:<destination_id>:<pass_index>`,
prefixed by session ID when combining recordings. Route landmarks repeat the
complete stored list on each page; replace or merge by those IDs. Their `items`
exclude generic glacier point landmarks. Existing cursor/version rules still apply.

Entry/exit distances accumulate original geodesic edge lengths. Fractions come
from exact polygon clipping. Elevations and timestamps interpolate on that same
original directed edge, never from intersection Z or catalog head/terminus facts.
Min/max also include interior sample vertices. Missing elevation/time stays null;
zero/invalid time is untimed, and equal valid endpoint times are allowed.

Sessions never connect recording segments, null locations, samples more than
1,000 m apart, or samples more than 1,200 seconds apart. Distances omit those
edges. These conservative gap limits need a later check against real recordings.
Catalog routes have no GPS-gap cap. Tangency and travel exactly on an outer or
hole border do not count; internal subdivision seams do not split a pass.
`starts_inside` / `ends_inside` mean the available continuous block begins/ends
inside the glacier, so a partial visit need not be called a full traverse.

No new photo endpoint is added. Fetch photos by the returned session IDs and
keep their activity/date labels. A crossing does not prove all photos in that
session were taken on ice. The sheet order remains title, personal activity,
short credited copy, facts, photos, sessions, then routes.

## Write paths, repair and cost

Route path triggers refresh stored crossings after direct path writes and
segment composition; clearing a path clears spans. They inspect at most 512
original edges per geometry window and retain only nearby candidate edges.
Session `processSession` calls the same SQL engine after track inputs are ready.
A statement-level tracking-point trigger marks changed recordings pending before
processing; unchanged samples and unrelated sample metadata keep their markers.
The matcher stores intervals in `route_glacier_crossings` and
`session_glacier_crossings`; it does not alter route objectives or split segments.

`destination_boundary_parts` supplies indexed candidates; interval midpoints
must lie in the original polygon interior. A database guard covers every old
automatic reach writer, including the web backfill and destination-insert
trigger: an approximate glacier hit queues processing, and only positive stored
crossings may create an automatic reached row. Manual assertions remain separate.

Boundary/feature/owner changes queue both old and new footprints and prior
crossings. Changed result sets update session sync timestamps; unchanged inputs
skip matching. Internal match marker updates alone do not cause sync churn.
Crossing glacier names refresh `route_search_terms`, including renames and owner
changes. Pending matches contribute no borrowed glacier names. The existing sweep processes at most two queued route repairs per call;
session repairs use its existing queue. No service, timer, pool increase, or
always-on work is added. Expected added fixed cost: **$0/month**. Storage, write
CPU and cold/warm query latency still need measurement on representative data.

## Runbook for the main session

These commands describe later, authorized work. This task applied no migrations,
connected to no database, imported no rows, deployed nothing and pushed nothing.
Use the repo's normal backup and deployment procedure for any later production
run. DDL runs as postgres; the runtime role receives DML and narrow function calls.

1. Rehearse the boundary typmod change and indexes in a disposable `_test` DB;
   measure lock time and disk use. Apply and **commit** the enum file first,
   then the remaining files in order (all prior main migrations are required):

   ```sh
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_01_feature.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_02_catalog.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_03_crossings.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_04_refresh_search.sql
   ```

   `cloud-sql/test-db/provision.sh` applies the baseline, migrations and test-role
   grants. Do not apply only `schema.sql`. The enum addition is its own file;
   the core schema uses a five-second lock timeout. No source polygons are dropped
   to fit the old Polygon typmod.

2. Run offline checks from each package:

   ```sh
   cd cloud-sql/api
   npm run typecheck
   npm run build
   npm run lint
   NODE_ENV=test node --test --import tsx src/__tests__/glaciers.test.ts src/__tests__/glacier-api.test.ts
   cd ../migrate
   ./node_modules/.bin/tsc --noEmit -p .
   npm run build
   NODE_ENV=test node --test --import tsx src/__tests__/rainier-glaciers.test.ts
   ```

   Run PostGIS cases only with `TEST_DATABASE_URL` naming the disposable database:

   ```sh
   # From repo root, after provision.sh with ADMIN_DATABASE_URL ending in _test:
   cd cloud-sql/api
   export TEST_DATABASE_URL='<disposable-postgres-url-with-database-ending-_test>'
   NODE_ENV=test node --test --test-concurrency=1 --import tsx \
       src/__tests__/glacier-crossings.integration.test.ts
   # Broader regression suites, same disposable URL:
   npm run test:db
   cd ../migrate
   NODE_PATH="$PWD/node_modules" npm test
   npm run test:db
   ```

   The socket-free `glacier-api.test.ts` also checks the real Express response
   path with a mocked database, including legacy filtering and repeated spans.
   The engine cases cover outside endpoints, repeat visits, holes, multipart,
   gap splits, tangent/border contact, piece seams, missing Z/time, timestamps,
   route refresh, rejections, search rows, private reads and distinct-session
   totals. No PostGIS case ran in this implementation task. Full HTTP/CLI test
   runs need a host where local socket binding is allowed; this sandbox returns
   `listen EPERM`. Migrate tests importing web helpers also need `sharp` resolvable
   via the shown `NODE_PATH` or installed web dependencies.

3. Preview the immutable package **without a database**:

   ```sh
   cd cloud-sql/migrate
   mkdir -p .cache
   node --import tsx src/import-rainier-glaciers.ts > .cache/rainier-preview.json
   ```

   The parser verifies the supplied OSM SHA-256, 29 names, complete tables and
   WGS84 rings, then reports geometry components/holes and the fact manifest hash.
   Current source normalization has **33 polygon components and 22 holes**.
   Keep the preview's `manifest_sha256`; it binds geometry, report, saved pages,
   descriptions and normalized facts. A changed source or parser changes the hash.

4. Resolve the actual parent and park IDs with read-only queries. Review the
   names, features, coordinates and park footprint; do not choose an arbitrary
   same-name row. The importer verifies both supplied IDs and whole-shape park
   coverage, and rejects OSM/Wikidata/name collisions. All source shapes pass a
   read-only validity/scope check before the first write:

   ```sql
   SELECT id,name,features,country_code,state_code,
          ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng
   FROM destinations WHERE name='Mount Rainier' AND owner='peaks';
   SELECT id,name,kind,source,parent_area_id FROM areas
   WHERE name='Mount Rainier National Park' AND kind='national_park';
   ```

5. With later data-write authorization, import one place per transaction.
   The explicit URL is the sole connection; this script starts no proxy or
   network acquisition. Apply requires the reviewed manifest hash:

   ```sh
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/import-rainier-glaciers.ts --apply \
       --expected-manifest-sha256='<hash-from-preview>' \
       --parent-mountain-id='<checked-rainier-id>' --park-area-id='<checked-park-id>'
   ```

   A replay repairs owned fields and missing links, preserves other metadata,
   skips unchanged bytes/facts, and keeps the same destination IDs. A failed
   place rolls back; rerun with the same reviewed package to resume.

6. Build the API, then repair in small, serial batches. The repair command loads
   the built canonical session processor, so session route/area/popularity facts
   stay consistent too. Use `--seed` once for repair of old/cleared queue state,
   then repeat without it until `processed` is zero. Each invocation handles at
   most `--limit` work items (default 10; allowed 1–100). Routes drain first;
   `--kind=routes` or `--kind=sessions` narrows a run.

   ```sh
   # From repo root:
   (cd cloud-sql/api && npm run build)
   cd cloud-sql/migrate
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/backfill-glacier-crossings.ts
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/backfill-glacier-crossings.ts --apply --seed --limit=5
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/backfill-glacier-crossings.ts --apply --limit=5
   ```

   The default command reads queue counts only. Durable queues are the resume
   state. A failed transaction leaves its item queued; concurrent newer queue
   entries survive. No new scheduler is needed.

7. Verify relationships, missing IDs and geometry as well as counts. Review every
   non-empty missing-row query. Counts alone do not prove a complete backfill.

   ```sql
   SELECT kind,count(*) FROM destination_glacier_facts GROUP BY kind;
   -- Expected: glacier 28, snowfield 1.

   SELECT d.id,d.name FROM destinations d
   LEFT JOIN destination_glacier_facts gf ON gf.destination_id=d.id
   WHERE 'glacier'=ANY(d.features) AND gf.destination_id IS NULL;

   SELECT gf.destination_id,d.name FROM destination_glacier_facts gf
   JOIN destinations d ON d.id=gf.destination_id
   LEFT JOIN destinations pm ON pm.id=gf.parent_mountain_id
   LEFT JOIN destination_search_rows ds ON ds.id=d.id
   WHERE pm.id IS NULL OR ds.id IS NULL
      OR NOT EXISTS(SELECT 1 FROM destination_areas da JOIN areas a ON a.id=da.area_id
        WHERE da.destination_id=d.id AND a.name='Mount Rainier National Park')
      OR NOT EXISTS(SELECT 1 FROM destination_boundary_parts bp WHERE bp.destination_id=d.id);

   SELECT d.name,GeometryType(d.boundary::geometry) AS exact_type,
          ST_IsValid(d.boundary::geometry) AS exact_valid,
          ST_IsValid(d.boundary_display::geometry) AS display_valid,
          ST_NumGeometries(d.boundary::geometry) AS components,
          ST_NPoints(d.boundary::geometry) AS exact_vertices,
          ST_NPoints(d.boundary_display::geometry) AS display_vertices,
          pg_column_size(d.boundary) AS exact_bytes,
          ST_HausdorffDistance(ST_Transform(d.boundary::geometry,32610),
            ST_Transform(d.boundary_display::geometry,32610)) AS display_error_m
   FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id;

   SELECT d.id,d.name FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id
   WHERE NOT ST_Equals(d.boundary::geometry,(SELECT ST_UnaryUnion(ST_Collect(bp.boundary_part::geometry))
     FROM destination_boundary_parts bp WHERE bp.destination_id=d.id));

   SELECT c.* FROM session_glacier_crossings c
   JOIN session_destination_rejections r USING(session_id,destination_id);
   -- Expected: no rejected spans.

   SELECT count(*) FROM route_glacier_rematch_queue;
   SELECT count(*) FROM session_rematch_queue
   WHERE reason LIKE 'glacier:%' OR reason LIKE 'glacier-rejection:%';

   SELECT c.route_id FROM route_glacier_crossings c
   JOIN destinations d ON d.id=c.destination_id
   WHERE NOT EXISTS(SELECT 1 FROM route_search_terms rst
     WHERE rst.route_id=c.route_id AND rst.term=d.search_name);

   SELECT pg_size_pretty(pg_total_relation_size('destination_glacier_facts')) AS facts,
          pg_size_pretty(pg_total_relation_size('route_glacier_crossings')) AS routes,
          pg_size_pretty(pg_total_relation_size('session_glacier_crossings')) AS sessions;
   SELECT proname,procost FROM pg_proc WHERE proname IN
     ('similarity','similarity_op','strict_word_similarity','strict_word_similarity_op');
   -- Trigram function costs remain 100 (20261028_trgm_function_cost.sql).
   ```

   Compare pieces in a metric CRS with a small numeric tolerance if the exact
   equality check shows only densification roundoff; inspect differences before
   accepting them. Measure candidate counts, buffers, elapsed time and response
   bytes for `emmons`, `emmons glacier`, `em`, a typo, `glacier`, `rainier`,
   `interglacier`, `mount stuart`, `lake` and `trail`, cold and warm. Unit tests
   do not establish micro-instance latency or migration lock cost.
