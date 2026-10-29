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
new glacier facts/crossing/stretch fields are absent. Existing lake boundaries keep their
current shape and behavior.

If the engine migrations are absent, capable route/session readers send
`glacier_crossings: []`, `glacier_stretches: []` and `glacier_crossings_status: "unavailable"`.
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
| `GET /routes/:id` | Adds `glacier_crossings`, `glacier_stretches` and `glacier_crossings_status`. |
| `GET /routes/:id/landmarks?cursor=` | Keeps `{items,nextCursor,distanceThroughMeters}`; adds those same three fields, independently of paged point landmarks. |
| `GET /sessions/:id` | Adds track-derived `glacier_crossings`, `glacier_stretches` and `glacier_crossings_status`, independent of a primary route. |
| `GET /sessions/:id/route-facts` | New compact `{session_id,segments,glacier_crossings,glacier_stretches,glacier_crossings_status}`. `segments` retains the existing primary-route contract; glacier spans do not depend on it. |
| `POST /sessions/:id/destinations` | Existing `rejected` / `unreject` lists also govern glacier crossings. No body change. A rejection hides/deletes derived spans at once; unreject queues a fresh match. Manual reaches do not invent spans. |
| `GET /sessions/changes` | Existing sync envelope stays unchanged. Changed crossings touch the session's sync timestamp. Fetch detail/route-facts after an upsert; omitted crossing fields in list/sync rows do not mean deletion. |

A query compound ending in `glacier` splits before matching: `Interglacier` normalizes
to `inter glacier`. Importers record other spellings in
`destinations.metadata.glacier_catalog.aliases`; route search terms and crossing
JSON read them from there. No runtime code names a glacier. Search keeps the October word-candidate cap, trigram
indexes and function costs. It does not join boundary geometry or crossing tables
when scoring destination candidates. Full rows load after the shortlist.

A search destination summary looks like this; optional existing scores and area
summaries follow the endpoint's current contract. For capable callers, every
glacier row in a destination summary response — `/search`, `/search/all`
(`destinations` bucket and any nested destination arrays), `/search/features`,
`/destinations/nearby`, `/destinations/viewport`, and nested destination arrays
elsewhere (areas, lists, sessions) — carries a compact `glacier` object with
`kind`, the checked `parent_mountain`, and the row's `geometry_credit`,
`geometry_license`, `outline_observed_at`, `outline_source_url` and
`outline_provenance` (the stored `provenance.outline`, or null for an older row).
A row that already has the full
detail `glacier` object keeps it. The ranked `results[].data` summaries stay
unchanged; join them to their bucket row by `id`.

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
  "areas": [],
  "glacier": {
    "kind": "glacier", "parent_mountain": {"id": "<rainier-id>", "name": "Mount Rainier"},
    "geometry_credit": "© OpenStreetMap contributors", "geometry_license": "ODbL-1.0",
    "outline_observed_at": "2026-10-28",
    "outline_source_url": "https://www.openstreetmap.org/relation/5535843",
    "outline_provenance": {"observed_at": null, "snapshot_at": "2026-10-28"}
  }
}
```

The summary `glacier` loads after each query's final LIMIT: one primary-key
lookup on `destination_glacier_facts` joined to its parent destination, for the
response's glacier ids only. It never joins into candidate scoring. A parent the
caller cannot read (not Peaks-owned and not theirs) leaves the field absent, as
in detail. Old callers never see it. If the lookup fails, the response is sent
without it.

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
    "inventory_name": "Emmons",
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
      "area_uncertainty_km2":4.109,"history_start_year":1896,"percent_change_since_history_start":-41.6
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
      "outline": {
        "schema_version":1,"geometry_source":"OpenStreetMap",
        "source_url":"https://www.openstreetmap.org/relation/5535843",
        "source_sha256":"02cea8bc617563b180036921c7114b56e0234c359a0af174cf24becc37cf5cb0",
        "observed_at":null,"snapshot_at":"2026-10-28",
        "license":"ODbL-1.0","license_url":"https://www.openstreetmap.org/copyright",
        "credit":"© OpenStreetMap contributors","geometry_sha256":"<normalized-geometry-sha256>",
        "method":"OSM snapshot; imagery observation date unknown","review":{"chosen_source":"osm"}
      },
      "mountain_context": {
        "observed_year":2021,"named_glacier_count":28,"area_km2":75.496,
        "area_uncertainty_km2":4.109,"history_start_year":1896,"percent_change_since_history_start":-41.6
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

Every credit, source link and mountain total above comes from the facts row
(`facts_credit`, `facts_source_url`, `geometry_credit`, `geometry_license`,
`provenance.mountain_context`) that the import wrote. The schema has no source
defaults, and clients show a credit or a "of N" rank only when the row carries
it. `inventory_name` is the glacier's name in the facts source, when it differs.

All physical measurements are JSON numbers or null, never numeric strings or
placeholder zeroes. The area and volume use the report's m²/m³ values converted
to km²/km³; history retains its published rounded km². Slope uses Table 5's
integer mean. Flow bearing means the direction ice flows **towards**, clockwise
from north; it is not a separately measured aspect. Type codes exist only where
the saved NPS glacier page states them (`S` near summit; `C` cirque/head below
summit). Missing codes remain null. Volume is a statistical estimate, not a survey.

`outline_observed_at` is the compatible **mapped date**: the place's actual
outline observation when known, otherwise its mapping snapshot date. Retained
OSM rows still send `2026-10-28`; the selected GLIMS/PSU rows send `2019-09-09`.
The JSONB keeps `observed_at` and `snapshot_at` separate: undated OSM has actual
observation null. Physical facts still describe 2021. Historic routes/sessions
match the current stored outline for each glacier, rather than date-matched
historic ice. Full detail also returns the row's mapped date at top level.

The read-only iOS check found `GlacierFacts.outlineObservedAt` parsing
`outline_observed_at` in `peakscore/PeaksModels/Glaciers.swift`, and
`GlacierDetailView.credits` reading it for “Outline as mapped in <month year>”.
That field and date format stay compatible. A later iOS wording change can
read `glacier.provenance.outline.observed_at` / `.snapshot_at`; summary and
crossing readers get the same object as `outline_provenance`. No app edit or
new required client field is needed for this refresh.
Both capable detail endpoints return `destination_glacier_facts.outline` as the
`boundary`: a MultiPolygon with every OSM component, hole and vertex, in GeoJSON
`[longitude,latitude]` order. The `glacier` facts object omits the stored geometry;
clients read it from `boundary`. The API does not simplify it on read.

`destinations.boundary` stays `geography(Polygon,4326)`. For a glacier it holds
the largest polygon part by geodesic area, including that part's holes. Its pin
lies in that polygon; its bounding box covers the full outline. Existing display,
boundary-parts and rematch triggers keep their behavior. Other destination detail
responses keep their existing boundary shape. Only Flett (3), Kautz (2) and
Columbia Crest (2) have multiple parts; the other 26 outlines have one polygon.

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
total_time,activity_type,high_point,ascent_time,descent_time,still_time,pace,
source,external_id,processing_state,processing_error,processed_at,group_id,ended,
is_public,updated_at,server_updated_at,path_preview,destinations_reached`
and `glacier_crossings`. The latter is a small list for this glacier only, with
`pass_index,entered_at,exited_at,entered_distance_m,exited_distance_m,
min_elevation_m,max_elevation_m`. Timestamps are ISO 8601 or null. Preview paths
are the existing small GeoJSON LineStrings. `destinations_reached` uses the area
summary shape: `id,name,elevation,features,lat,lng`.

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
and type codes remain null. Retained OSM geometry credit is
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under
ODbL. Facts credit is
[Beason et al. (2023), National Park Service](https://doi.org/10.36967/2299328).
The four selected inventory rows instead carry
`Fountain, Glenn & McNeil (2023), via GLIMS`, CC0-1.0, observed 2019-09-09,
and [their data DOI](https://doi.org/10.15760/geology-data.03). The NPS 2021
shapefile is not an input. See the [outline review and full decision table](glacier-outline-refresh.md#decision-for-rainier)
for cohort, matching, extent-age evidence, remaining flags and source hashes.

## Crossing shape and semantics

A route or session detail adds:

```json
{
  "glacier_crossings_status": "complete",
  "glacier_crossings": [{
    "destination_id": "B5B5E8E3D1BFB7A3126D",
    "name": "Emmons Glacier",
    "kind": "glacier",
    "aliases": [],
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
    "geometry_credit": "© OpenStreetMap contributors",
    "geometry_license": "ODbL-1.0",
    "outline_source_url": "https://www.openstreetmap.org/relation/5535843",
    "outline_provenance": {"observed_at": null, "snapshot_at": "2026-10-28"}
  }],
  "glacier_stretches": [{
    "kind": "glacier",
    "destinations": [{"id":"B5B5E8E3D1BFB7A3126D","name":"Emmons Glacier","kind":"glacier","share":1}],
    "entered_distance_m": 2300.5,
    "exited_distance_m": 5100.25,
    "entered_at": "2026-08-01T08:10:00.000Z",
    "exited_at": "2026-08-01T10:00:00.000Z",
    "segment_number": 2,
    "min_elevation_m": 2590,
    "max_elevation_m": 3420,
    "crossing_indexes": [0]
  }]
}
```

`complete` with `[]` means the match ran and found no positive span. `pending`
with `[]` means no current result exists; reload after processing. `unavailable`
means schema support is absent. A failed canonical session process retains its
existing `processing_state` / `processing_error`; no fabricated empty completion
replaces it. Route times are null and `segment_number` is zero. Session segment
numbers are the saved recording segment, not a route segment ID. Crossing times,
here and in glacier session summaries, are UTC ISO 8601 with milliseconds, as above.

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

### Display stretches

The four route/session endpoints above also return `glacier_stretches` for
`glaciers-v1` callers. They leave `glacier_crossings` unchanged. Use stretches for
display rows and crossings for exact geometry, passes and source credit. Empty,
pending and unavailable crossings all produce `glacier_stretches: []`; read
`glacier_crossings_status` to tell them apart. Landmark pages repeat the complete
stretch list, just as they repeat crossings. Replace the display list on reload;
stretch row positions are not stored pass identities.

`buildGlacierStretches` is a pure read-time function. Its single threshold object,
`GLACIER_STRETCH_THRESHOLDS` in `cloud-sql/api/src/lib/glacier-stretches.ts`, defines:

| Constant | Value | Rule |
| --- | --- | --- |
| `decision_step_m` | 5 m | Round decision distances and length support to the nearest 5 m. Keep output distances exact. |
| `sliver_max_m` | 40 m | Absorb an isolated neighbour excursion with the same glacier immediately before and after. |
| `same_glacier_gap_m` | 200 m | Merge adjacent visits to the same glacier across a short off-ice gap. |
| `border_gap_m` | 20 m | Larger gaps break jitter analysis; sliver neighbours must also meet this limit. |
| `settled_run_m` | 400 m | Keep a single-glacier run with this much matched support as a settled run beside jitter. Off-ice gaps add no support. |
| `border_min_span_m` | 300 m | Require this span for sustained border alternation. |
| `border_min_switches` | 3 | Require at least three switches; simultaneous overlapping outlines also supply border evidence. |
| `border_min_minor_share` | 0.2 | At least 20% of support must belong to glaciers other than the leader. |
| `transition_max_span_m` | 600 m | Absolute cap for jitter absorbed between two different settled glaciers. |
| `transition_flank_fraction` | 0.5 | Also cap absorbed transition jitter at half the shorter settled run's matched length. |

Distance comparisons use those 5 m bins, so nominal limits have a 2.5 m rounding
band. This reduces changes from sub-metre clipping differences. Slivers resolve
in travel order. The function sorts a copy of its input and never edits it.

After sliver removal, settled single-glacier runs divide each nearly continuous
block into possible jitter sections. Between different settled glaciers A and B,
a short section involving only A/B becomes A then B: **split at the last switch
into the settled B run**, assigning preceding jitter to A. This keeps the original
endpoint distances and times. Longer sections with repeated alternation and no
clear winner become one `kind: "border"` row. Sections that meet neither rule
keep their individual visits; a brief visit without a return stays visible.
A glacier that appears only once at either end of a jitter section also keeps
its own row. A new arrival alone does not establish continued border travel.

Each row carries all its destinations, ordered by length share, with ties broken
by destination ID. Shares sum to one. They use unioned matched length per glacier,
rounded to 5 m (minimum 5 m for a positive contribution), and exclude off-ice gaps.
Sliver/transition support belongs to the glacier that absorbs it. Overlapping
outlines may contribute support to more than one destination; normalize their
support together. A single-glacier row has share 1. For three or more destinations,
show the first two names and the remaining count, for example `A / B +1`; the API
keeps every identity and share rather than dropping the smaller destinations.

`entered_distance_m` / `exited_distance_m` bound the combined span, including any
bridged gaps; they do not claim that every metre lies on ice. `crossing_indexes`
contains sorted, unique zero-based indexes into this response's exact crossings,
including absorbed neighbours. An overlapping source crossing can contribute to
several stretches. Min/max elevations take all non-null source extrema, including
absorbed crossings; they are conservative when a source crossing spans several
rows. Missing elevations stay null. Entry/exit times come from existing crossing
endpoints; missing times stay null or absent, with no time invented across a gap.
Routes retain null times and segment zero. Sessions retain their recording segment
and never merge across different `segment_number` values. Both use the same rules.

The saved Rainier fixture yields these Disappointment Cleaver rows:

| Row | Entry–exit distance (m) |
| --- | --- |
| Muir Snowfield | 4029.7–6649.2 |
| Cowlitz Glacier | 6692.6–7506.3 |
| Ingraham Glacier | 7828.4–8801.6 |
| Ingraham Glacier | 9549.5–9800.7 |
| Emmons Glacier | 9800.7–10378.1 |
| Ingraham Glacier / Emmons Glacier | 10378.1–11238.7 |
| Columbia Crest Glacier | 11256–11815.9 |

The 747.9 m Cleaver rock gap separates the two Ingraham visits. The 577.4 m Emmons
run exceeds the settled threshold, so it stays visible before the 860.6 m border
section (about 73% Ingraham, 27% Emmons). The final 129 m Ingraham pass does not
establish a settled exit from that border. Columbia Crest's 28.8 m return joins
its earlier pass across 165.2 m of rock. The Emmons Glacier Route yields Inter
Glacier, Emmons Glacier, Winthrop Glacier, Columbia Crest Glacier: its 40.7 m Inter
Glacier gap merges, and its 12.3 m Emmons excursion folds into Winthrop.

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

`glacier_outline_parts` supplies indexed candidates from **all** parts of
`destination_glacier_facts.outline`. Both tables have GiST geometry indexes.
An outline-write trigger dumps each component and uses the existing exact
256-point subdivision helper; it leaves `destination_boundary_parts` unchanged.
Interval midpoints must lie in the full outline's interior. A database guard covers every old
automatic reach writer, including the web backfill and destination-insert
trigger: an approximate glacier hit queues processing, and only positive stored
crossings may create an automatic reached row. Manual assertions remain separate.

Outline/boundary/feature/owner changes queue both old and new footprints and prior
crossings, including routes and ended sessions near a smaller part. An outline
edit advances `outline_revision` even when the largest polygon stays fixed;
an unchanged outline keeps its revision and queues nothing. Changed result sets update session sync timestamps; unchanged inputs
skip matching. Internal match marker updates alone do not cause sync churn.
The importer writes the chosen full outline to facts and its largest polygon
to the legacy boundary in the same place transaction. Source/provenance-only
updates do not queue crossings. An identical manifest replay changes no owned
values, timestamps, revisions or queue dates. The first refresh also fills
per-place provenance on retained OSM rows; it keeps their geometry bytes.
Crossing glacier names refresh `route_search_terms`, including renames and owner
changes. Pending matches contribute no borrowed glacier names. The existing sweep processes at most two queued route repairs per call;
session repairs use its existing queue. No service, timer, pool increase, or
always-on work is added. Expected added fixed cost: **$0/month**. Storage, write
CPU and cold/warm query latency still need measurement on representative data.

## Adding another mountain

Follow the step-by-step skill
[`.agents/skills/peaks-glacier-import/SKILL.md`](../.agents/skills/peaks-glacier-import/SKILL.md).
It marks which steps a cloud agent may run and which need the privileged session.
The new yearly refresh phase is ready to append in
[the outline-refresh document](glacier-outline-refresh.md#skill-phase-ready-to-append);
`.agents/` was read-only for this implementation task.

No API, schema or app change is needed. The writer
`cloud-sql/migrate/src/import-glacier-manifest.ts` takes one JSON manifest
(type `GlacierManifest`) that carries everything mountain-specific:

- `parent`: the parent destination's name, features, country/state, point and
  radius. Apply refuses a `--parent-mountain-id` that fails any of them.
- `container_area`: the area kind and name every outline must lie inside,
  checked against `--park-area-id`.
- Or, when outlines span several areas or none covers them (Mount Baker:
  Easton and Squak cross from the wilderness into the national recreation
  area), `container_areas` keyed by a short name, and on each place
  `container_area_key`: a key, or `null` for no container. Apply then takes one
  `--area-id=KEY=ID` per key used, checks each area's kind/name and coverage
  of its places, and links only those places. A `null` place still gets the
  validity check but no coverage check or `destination_areas` link.
- `parents` (optional): further parent summits keyed by a short name, each
  with the same identity fields and an optional `mountain_context`. A place
  with `parent_key` uses that parent; apply takes `--parent-id=KEY=ID` for
  each key used, and `--parent-mountain-id` for places on the default `parent`.
- Credits and sources: package `geometry_source`, `geometry_credit`, `geometry_license`
  and `geometry_observed_at` remain defaults for older single-source manifests;
  `facts_credit`, `facts_source_url`, `description_source_name`,
  `description_source_license`.
- `country_code`, `state_code`, `activities` and `mountain_context`
  (`named_glacier_count` drives the "of N" rank; `history_start_year` and
  `percent_change_since_history_start` are optional mountain totals).
- `places[]`: deterministic id, name, OSM key and external ids, `kind`,
  `aliases`, MultiPolygon `boundary`, `facts` (any fact may be null), and each
  new builder's `geometry` provenance object: `schema_version: 1`,
  `geometry_source`, `source_url`, `source_sha256`, `observed_at` or null,
  `snapshot_at` or null, `license`, `license_url`, `credit`, `method`, and
  `geometry_sha256` (SHA-256 of `JSON.stringify(boundary)`). Inventory rows
  also carry analysis/glacier/submission IDs and the review decision. The writer
  checks dates, URLs, hashes and matching facts provenance before apply.
- `outline_refresh`: the original OSM manifest hash and review hash, binding
  decisions and unmatched features to the manifest's apply gate. The report
  hash uses an empty `output_manifest_sha256` to avoid a cycle.

Steps: save and hash the source files under `cloud-sql/migrate/data/`; write a
builder beside `glaciers/rainier.ts` and `glaciers/baker.ts`, parsing OSM with
the shared `parseOsmGlaciers` (`glaciers/osm.ts`, with a roster and snowfield
names); or write the manifest by hand; save it with
`--write-manifest=FILE` or as a reviewed file; dry-run
`npm run import:glacier-manifest -- --manifest=FILE`; then apply with
`--apply --expected-manifest-sha256=<printed> --parent-mountain-id=<checked>
--park-area-id=<checked>` and `GLACIER_DATABASE_URL`. Run
`backfill:glacier-crossings` afterwards. The Rainier script is one such builder:
`import:rainier-glaciers` builds its manifest from the saved OSM snapshot, NPS
report and pages, then calls the same writer.
It now also reads the saved GLIMS cohort and source config through the generic
refresh step. `--osm-only` emits the original baseline. To refresh another
mountain, pass that mountain's OSM manifest to `refresh-glacier-outlines.ts`
with its source config, report prefix and output path. This CLI has no network
or database mode. It requires names/aliases and overlap, unions parts, reports
ambiguities, and applies the inclusive [0.67, 1.5] rule with dated extent
evidence. It preserves facts and identity fields. See [exact offline commands](glacier-outline-refresh.md#offline-commands-and-apply-handoff).

## Runbook for the main session

Use a disposable `_test` DB for local verification. Production changes need
separate authorization and the repo's backup and deployment procedure.
DDL runs as postgres; the runtime role receives DML and narrow function calls.

1. Rehearse the new tables and indexes in a disposable `_test` DB.
   No migration changes the destinations boundary typmod, rewrites that table,
   or replaces its display/parts/rematch triggers. Apply and **commit** the enum file first,
   then the remaining files in order (all prior main migrations are required):

   ```sh
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_01_feature.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_02_catalog.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_03_crossings.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_04_refresh_search.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_05_bbox_queue.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_06_skip_insert_link.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_07_factory_guard.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_glacier_08_route_window_boxes.sql
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261029_glacier_09_outline_provenance.sql
   ```

   `cloud-sql/test-db/provision.sh` applies the baseline, migrations and test-role
   grants. Do not apply only `schema.sql`. The enum addition is its own file;
   the core schema uses a five-second lock timeout. Full source outlines live in
   glacier facts; the importer selects the largest part for the existing Polygon column.
   Existing installations need only the new additive **09** file; do not replay
   or edit applied files 01–08. Migration 09 fills missing outline JSONB from
   row source/credit/date columns, keeps actual observation null for the old
   mapping snapshots, and leaves geometry, revisions and crossing queues alone.

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
   NODE_ENV=test node --test --import tsx src/__tests__/rainier-glaciers.test.ts src/__tests__/glacier-outline-refresh.test.ts
   NODE_PATH="$PWD/node_modules" npm test
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
   NODE_PATH="$PWD/node_modules" NODE_ENV=test node --test --test-concurrency=1 --import tsx \
       src/__tests__/glacier-manifest.integration.test.ts
   NODE_PATH="$PWD/node_modules" npm test
   npm run test:db
   ```

   The socket-free `glacier-api.test.ts` also checks the real Express response
   path with a mocked database, including legacy filtering and repeated spans.
   The engine cases cover outside endpoints, repeat visits, holes, multipart,
   gap splits, tangent/border contact, piece seams, missing Z/time, timestamps,
   route refresh, rejections, search rows, private reads and distinct-session
   totals. Smaller-part cases cover both route and session writes, old/new
   queue footprints, and cached empty matches after an outline-only edit.
   Full HTTP/CLI test runs need local socket access. Migrate tests importing web helpers also need `sharp` resolvable
   via the shown `NODE_PATH` or installed web dependencies.
   Install the updated migrate lockfile in the main session's own dependency
   tree (`polyclip-ts` 0.16.8). The implementation worker used read-only local
   package links because the supplied `node_modules` trees were symlinked; it
   made no network calls or writes through those symlinks. Migrate has no
   `lint` script; the worker ran ESLint on the changed glacier files using the
   API's installed ESLint/typescript-eslint with migrate's tsconfig. The
   [refresh log](glacier-outline-refresh.md#offline-commands-and-apply-handoff)
   lists exact local results and sandbox socket failures.

3. Preview the immutable package **without a database**:

   ```sh
   cd cloud-sql/migrate
   mkdir -p .cache
   node --import tsx src/import-rainier-glaciers.ts \
     --write-manifest=.cache/rainier-outline-manifest.json \
     --report-prefix=../../docs/data-audits/rainier-glacier-outline-decisions-2026-10-28 \
     > .cache/rainier-preview.json
   ```

   The parser verifies the supplied OSM SHA-256, 29 names, complete tables and
   WGS84 rings, then reports geometry components/holes and the fact manifest hash.
   It checks the saved GLIMS SHA-256, one September 2019 cohort, name/overlap
   crosswalks, union validity and the selection rule. Review every row in the
   JSON/Markdown report, including unmatched/ambiguous features and remaining
   flags. The original OSM normalization has **33 components and 22 holes**;
   the refreshed package has **51 components and 39 holes**. Pyramid, Van
   Trump, Ohanapecosh and Paradise switch to GLIMS; Emmons and all other
   places retain OSM. Pyramid, Van Trump, Success, Sarvant and places with no
   individual facts area remain flagged for review. See the
   [per-glacier reasons](data-audits/rainier-glacier-outline-decisions-2026-10-28.md).
   Keep the preview's `manifest_sha256`; it binds geometry, report, saved pages,
   descriptions, normalized facts, per-place geometry provenance and the full
   outline review. A changed source, parser or review changes the hash. The
   current reviewed hash is
   `1ca5fb0861e792b05ae34a08a73826517d857db9b3ff047a424dd3ffd3f963fc`.

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
     node --import tsx src/import-glacier-manifest.ts \
       --manifest=.cache/rainier-outline-manifest.json --apply \
       --expected-manifest-sha256='<hash-from-preview>' \
       --parent-mountain-id='<checked-rainier-id>' --park-area-id='<checked-park-id>'
   ```

   A replay repairs owned fields and missing links, preserves other metadata,
   skips unchanged bytes/facts, and keeps the same destination IDs. A failed
   place rolls back; rerun with the same reviewed package to resume.
   Replay that exact command once and verify unchanged timestamps/revisions
   and queue dates. The DB-gated importer test covers this behavior plus a
   source/outline edit whose largest polygon stays fixed, old/new route and
   session queue footprints, parts and per-row credit/date/hash persistence.

6. Build the API, then repair in small, serial batches. The repair command loads
   the built canonical session processor, so session route/area/popularity facts
   stay consistent too. The CLI runs one item at a time with a two-connection
   pool for the session processor's post-commit work. Ordinary outline refreshes
   use their trigger-created queues. Use `--seed` only for repair of old/cleared
   queue state, then repeat without it until `processed` is zero. Each invocation handles at
   most `--limit` work items (default 10; allowed 1–100). Routes drain first;
   `--kind=routes` or `--kind=sessions` narrows a run.

   ```sh
   # From repo root:
   (cd cloud-sql/api && npm run build)
   cd cloud-sql/migrate
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/backfill-glacier-crossings.ts
   GLACIER_DATABASE_URL='<authorized-target-url>' \
     node --import tsx src/backfill-glacier-crossings.ts --apply --limit=5
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
      OR NOT EXISTS(SELECT 1 FROM destination_boundary_parts bp WHERE bp.destination_id=d.id)
      OR NOT EXISTS(SELECT 1 FROM glacier_outline_parts gp WHERE gp.destination_id=d.id);

   SELECT d.name,GeometryType(d.boundary::geometry) AS legacy_type,
          GeometryType(gf.outline::geometry) AS outline_type,
          ST_IsValid(gf.outline::geometry) AS outline_valid,
          ST_NumGeometries(gf.outline::geometry) AS components,
          ST_NPoints(gf.outline::geometry) AS outline_vertices,
          gf.area_km2 AS nps_2021_area_km2,ST_Area(gf.outline)/1e6 AS outline_area_km2,
          pg_column_size(gf.outline) AS outline_bytes
   FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id;

   SELECT d.id,d.name FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id
   WHERE NOT ST_Equals(d.boundary::geometry,(SELECT ST_UnaryUnion(ST_Collect(bp.boundary_part::geometry))
     FROM destination_boundary_parts bp WHERE bp.destination_id=d.id));

   SELECT d.id,d.name FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id
   WHERE NOT ST_Equals(gf.outline::geometry,(SELECT ST_UnaryUnion(ST_Collect(gp.outline_part::geometry))
     FROM glacier_outline_parts gp WHERE gp.destination_id=d.id))
      OR NOT ST_Equals(d.boundary::geometry,(SELECT geom FROM ST_Dump(gf.outline::geometry)
        ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1));
   -- Expected: no missing parts or wrong largest polygons. Facts and outline areas
   -- describe different dates/sources; Emmons NPS area is 10.959203 km2.

   SELECT gf.geometry_credit,gf.geometry_license,gf.outline_observed_at,count(*)
   FROM destination_glacier_facts gf WHERE gf.parent_mountain_id='<checked-rainier-id>'
   GROUP BY 1,2,3;
   -- Expected: OSM / ODbL-1.0 / 2026-10-28 = 25;
   -- Fountain, Glenn & McNeil (2023), via GLIMS / CC0-1.0 / 2019-09-09 = 4.

   SELECT d.id,d.name FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
   WHERE gf.parent_mountain_id='<checked-rainier-id>' AND (
     gf.provenance->'outline'->>'credit' IS DISTINCT FROM gf.geometry_credit
     OR gf.provenance->'outline'->>'license' IS DISTINCT FROM gf.geometry_license
     OR gf.provenance->'outline'->>'source_url' IS DISTINCT FROM gf.outline_source_url
     OR gf.provenance->'outline'->>'source_sha256' IS DISTINCT FROM gf.outline_source_sha256
     OR COALESCE(gf.provenance->'outline'->>'observed_at',gf.provenance->'outline'->>'snapshot_at')
       IS DISTINCT FROM to_char(gf.outline_observed_at,'YYYY-MM-DD'));
   -- Expected: no rows. OSM observed_at remains null; its mapped date is the snapshot.

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
