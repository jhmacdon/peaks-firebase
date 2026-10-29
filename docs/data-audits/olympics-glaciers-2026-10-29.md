# Olympic Mountains glaciers — review packet, 2026-10-29

**Draft: more than 15% of the region is flagged; decisions needed (below).**
Offline work only. Spec: `cloud-sql/migrate/src/import-olympics-glaciers.ts`.
Decisions: [Markdown](olympics-glacier-outline-decisions-2026-10-29.md),
[JSON](olympics-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`3694c9896f097e8a2f7517a303ca0ed71f0611df4f6520261ea3145d3f1f093d`.

## Sources and licences

| Source | Use | Licence | SHA-256 |
| --- | --- | --- | --- |
| OSM `natural=glacier`, mirror `overpass.private.coffee`, bbox 47.45,-124.00,48.05,-123.00; base 2026-07-15T15:22:01Z | Outlines | ODbL-1.0 | `71d88350…4ca5d` |
| Fountain, Glenn & McNeil (2023) via GLIMS WFS, cohort 2015-09-09 / 814 / PSU (134 analyses) | Area facts, outline candidate | CC0-1.0 | `da7180a7…4b8` |
| Same file, submission 744 cohorts 1943–1987 | Historical references only | not cleared | same |
| Same file, University of Washington 2015-08-01 / 647 (1,011 rows) | **Not used**: no licence evidence for this submission | — | same |
| RGI 7.0 region 02 via GLIMS WFS (1985–87 outlines) | Head elevation | CC BY 4.0 | `e2f822e9…0e0e` |
| USGS GNIS Domestic Names WA (use constraint "None") | Name checklist and summit points, analysis only | public domain | not committed |
| Copernicus GLO-30 DEM | Glacier head points for parents, analysis only | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA | not committed |

GNIS lists 15 named Olympic glaciers; OSM has 14 of them. **Lillian Glacier**
has no OSM polygon and no PSU 2015 row (RGI: "Lillian Glacier WA"); not imported.

## Roster: 11 places; 3 OSM polygons held back (flagged)

| OSM element | Name | Why held back |
| --- | --- | --- |
| relation:18773387 | White Glacier | Invalid geometry: inner way 1364013531 shares two edge segments with the outer way (OGC self-intersection at -123.7588092, 47.7942866). PostGIS would reject it; not repaired or redrawn. |
| way:1027283192 | Carrie Glacier | Label conflict: this polygon is the PSU "Carrie Glacier WA" feature (G236359E47900N), 1.0 km NW of GNIS Carrie Glacier. |
| relation:13754230 | Fairchild Glacier | Label conflict: this polygon contains the GNIS Carrie Glacier point; GNIS Fairchild Glacier lies 1.2 km from any OSM polygon. |

All three need an OSM correction before import (agents prepare evidence only).

## Outline decisions

| Glacier | OSM km² | GLIMS 2015 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Blue | 4.986 | 5.137 | 5.111 | 0.976 | 0.864 / 0.913 | osm |
| Hoh | 3.666 | 3.741 | 3.741 | 0.980 | 0.839 / 0.903 | osm |
| Humes | 1.620 | 1.361 | 1.361 | 1.190 | 0.836 / 0.997 | osm |
| Hubert | 0.849 | 0.627 | 0.627 | 1.354 | 0.644 / 0.922 | osm |
| Eel | 0.848 | 0.820 | 0.820 | 1.034 | 0.856 / 0.938 | osm |
| Ice River | 0.334 | 0.218 | 0.218 | 1.533 | 0.630 / 0.979 | **GLIMS 2015** (1987 reference IoU 0.778 vs 0.630) |
| Jeffers | 0.471 | 0.202 | 0.202 | 2.329 | 0.428 / 0.998 | **GLIMS 2015** (1987 reference IoU 0.636 vs 0.428) |
| Queets | 0.446 | 0.293 | 0.293 | 1.525 | 0.636 / 0.982 | osm ⚑ no dated evidence |
| Cameron Glaciers | 0.340 | 0.193 | 0.193 | 1.764 | 0.529 / 0.956 | osm ⚑ no dated evidence |
| Anderson | 0.130 | 0.013 | 0.013 | 10.165 | 0.087 / 0.898 | osm ⚑ no dated evidence (the glacier has nearly melted out) |
| Hanging | 0.076 | 0.061 | 0.061 | 1.257 | 0.743 / 0.962 | osm |

Blue's facts area (5.111, two parts) differs from its dissolved candidate
(5.137) because the cohort's parts overlap slightly.

## Parent mountain (Copernicus DEM head + GNIS summits)

| Glacier | DEM head (m) | Nearest summit to head | Proposed parent | Call |
| --- | ---: | --- | --- | --- |
| Blue | 2,377 | Mount Olympus 67 m | Mount Olympus | clear |
| Hoh | 2,355 | Middle Peak (Olympus) 20 m | Mount Olympus | clear (Olympus sub-summit) |
| Hubert | 2,124 | East Peak (Olympus) 1.7 km | Mount Olympus | clear |
| Jeffers | 1,817 | East Peak (Olympus) 2.5 km | Mount Olympus | clear |
| Humes | 1,905 | Mount Mathias 2.3 km | Mount Olympus | ⚑ heads on Olympus' east ridge |
| Ice River | 1,953 | Mount Mathias 1.9 km | Mount Olympus | ⚑ north side; Mount Mathias possible |
| Queets | 1,932 | Mount Queets 107 m | Mount Queets | ⚑ often listed with Olympus |
| Eel | 2,176 | Mount Anderson 68 m | Mount Anderson | clear |
| Hanging | 1,736 | East Peak (Anderson) 408 m | Mount Anderson | clear (Anderson sub-summit) |
| Anderson | 1,930 | Mount Anderson 886 m | Mount Anderson | clear |
| Cameron Glaciers | 2,158 | Mount Cameron 196 m | Mount Cameron | clear |

Expected Peaks summits (the privileged step resolves IDs):

| Parent | lat, lng (GNIS) | Features checked | Radius |
| --- | --- | --- | --- |
| Mount Olympus | 47.8013, -123.7106 | summit | 3000 m |
| Mount Queets | 47.7623, -123.5950 | summit | 1500 m |
| Mount Anderson | 47.7212, -123.3315 | summit | 1500 m |
| Mount Cameron | 47.8254, -123.3285 | summit | 1500 m |

"Of N": Mount Olympus 6 (Blue, Hoh, Hubert, Humes, Ice River, Jeffers),
Mount Anderson 3, Mount Queets 1, Mount Cameron 1. White Glacier heads on
Mount Tom (159 m from its head), Carrie and Fairchild on Mount Carrie; none is
imported, so those parents are not in this package.

## Containing area

All 11 → **Olympic National Park** (`national_park`); NPS boundary (Land
Resources Division service, analysis only), smallest margin 8 km.

## Flags (6 of 14 named OSM glaciers, 43%: over the 15% stop line)

1. White, Carrie, Fairchild held back (invalid geometry / label conflict).
2. Queets, Cameron, Anderson keep OSM outside the ratio band.
Parent calls flagged: Humes, Ice River, Queets.

Questions:
- Import the 11 now and add White, Carrie and Fairchild after OSM is fixed?
- Accept OSM for Queets, Cameron and Anderson as flagged, or hold them?
- Queets under Mount Queets (DEM) or Mount Olympus (common usage)?

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4; fixtures for the four parents and the NPS park
polygon. Import, replay unchanged; a line from the Hoh valley to the summit
crosses Hoh (886 m) and Blue (three passes) in route and session; backfill
drained; `glacier-region-verify.sql` run per parent: all missing-row queries
empty; credits OSM 9 (2026-07-15) and PSU 2 (2015-09-09).
