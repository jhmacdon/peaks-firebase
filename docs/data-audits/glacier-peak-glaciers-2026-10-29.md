# Glacier Peak glaciers — review packet, 2026-10-29

Offline work only: no production reads or writes, no OSM edits. Spec:
`cloud-sql/migrate/src/import-glacier-peak-glaciers.ts` (generic
`RegionSpec`). Decisions: [Markdown](glacier-peak-glacier-outline-decisions-2026-10-29.md),
[JSON](glacier-peak-glacier-outline-decisions-2026-10-29.json). Verification:
[glacier-region-verify.sql](glacier-region-verify.sql).

Reviewed manifest SHA-256 (platform-stable):
`9e183267f40c53f458a63c3a4be1ddf4dce23c0b1d34a02e639967a6b97ade02`.

## Sources and licences

| Source | Use | Licence | Saved file (SHA-256) |
| --- | --- | --- | --- |
| OSM `natural=glacier`, Overpass mirror `overpass.private.coffee`, bbox 48.02,-121.26,48.20,-120.97; base 2026-07-15T15:22:01Z | Outlines, identities | ODbL-1.0, © OpenStreetMap contributors | `glacier-peak-glaciers-overpass.json` (`79eb769a…dc5cd`) |
| Fountain, Glenn & McNeil (2023), GLIMS WFS, cohort 2015-09-09 / submission 814 / PSU (81 features) | Area facts, outline candidate | CC0-1.0 (`licence-evidence/pdxscholar-fountain-glenn-cc0.txt`) | `glims-wfs-glacier-peak.json` (`dd31135f…2b9cb`) |
| Same file, 1984-09-09 / submission 744 (82) | Historical reference only | not cleared for replacement | same |
| Same file, 2017-09-09 / submission 814 (4 unnamed) | Not used: one cohort per region | — | same |
| RGI 7.0 region 02 via GLIMS WFS (1984 outlines) | Head elevation (`zmax_m`) | CC BY 4.0 (`licence-evidence/rgi-data-distribution-policy.txt`) | `rgi7-wfs-glacier-peak.json` (`5ed6a040…50e60`) |

Licence evidence files are copies of the Baker fetches (same sources, same
day). All requests used `User-Agent: PeaksApp-glacier-import/1.0`.

## Roster

16 named OSM glaciers of Glacier Peak. Left out of the box:

| OSM element | Name | Reason |
| --- | --- | --- |
| relation:12844798 | Butterfly Glacier | Dakobed Range, 9.7 km E; North Cascades package |
| relation:12840881 | Clark Glacier | Clark Mountain, 13.5 km ESE; North Cascades |
| relation:16022870 | Moth Glacier | Dakobed Range, 8.3 km ESE; North Cascades |
| relation:12840900 | Pilz Glacier | Dakobed Range, 11.3 km ESE; North Cascades |
| relation:12840880 | Richardson Glacier | Dakobed Range, 12.3 km ESE; North Cascades |
| relation:12848893 | Tenpeak Glaciers | Tenpeak Mountain, 7.2 km ESE; North Cascades |
| 18 ways/relations | unnamed | named glaciers only |

Inventory glacier with no OSM polygon: **East White River** (0.075 km², south
of White River Glacier, no RGI row); counts in "of 16". OSM glacier with no
cohort row: **Gerdine Glacier** (1.760 km² in OSM); all facts null. No named
snowfields.

## Facts

As Baker: 2015 PSU area and rank; RGI 7.0 `zmax_m` head elevation (1984
outline); RGI terminus, length, slope and 1984 area in provenance only; no
history; no descriptions. RGI calls Milk Lake Glacier "Milk Lake Glacier WA"
(`RGI2000-v7.0-G-02-14041`, explicit `rgi_ids`). `mountain_context`: 16 named
glaciers, 18.021 km², 2015.

## Outline decisions

- **Ptarmigan Glacier → 2015 PSU outline.** OSM/facts 1.628; the 1984
  reference fits OSM better (IoU 0.707 vs 0.581), so OSM shows an older
  extent; the inventory outline (ratio 1.000) is newer. Credit becomes
  `Fountain, Glenn & McNeil (2023), via GLIMS`, CC0-1.0, observed 2015-09-09.
- **Flagged (2 of 16, 12.5%)**
  - **Milk Lake Glacier**: OSM 0.365 km² vs 0.023 km² in 2015 (15.8×; RGI
    1984: 0.256 km²). The 2015 inventory keeps a remnant inside the OSM shape
    (IoU 0.063) and no dated evidence shows OSM is older, so OSM stays.
  - **Gerdine Glacier**: no individual facts area.
- All others keep OSM, ratios 0.91–1.35.

## Parent mountain

All 16 → **Glacier Peak** (`summit`, `volcano`; US-WA; 48.1125, -121.1139;
radius 3000 m).

| Glacier | Nearest ice (m) | Centroid (m) | Bearing | Head, RGI zmax (m) | Call |
| --- | ---: | ---: | ---: | ---: | --- |
| Chocolate | 69 | 1,719 | 91 | 3,210 | clear |
| Kennedy | 128 | 1,236 | 330 | 3,121 | clear |
| Scimitar | 202 | 1,458 | 295 | 3,206 | clear |
| Cool | 376 | 1,607 | 121 | 3,099 | clear |
| Sitkum | 470 | 1,317 | 256 | 2,971 | clear |
| Dusty | 700 | 1,963 | 38 | 3,059 | clear |
| North Guardian | 1,110 | 1,908 | 55 | 2,713 | clear |
| Ermine | 1,321 | 2,403 | 14 | 2,830 | clear |
| Vista | 1,784 | 2,695 | 359 | 2,563 | clear |
| Ptarmigan | 2,333 | 3,398 | 340 | 2,512 | **flag**: DEM head 35 m from Kennedy Peak (Glacier Peak sub-summit) |
| Gerdine | 932 | 2,762 | 159 | — | **flag**: no inventory row; DEM head 156 m from Disappointment Peak (sub-summit) |
| Suiattle | 3,563 | 4,625 | 159 | 2,482 | **flag**: southern icefield toward Kololo Peaks |
| Milk Lake | 4,248 | 4,696 | 324 | 1,959 | **flag**: detached NW cirque near Milk Lake |
| White Chuck | 4,930 | 5,645 | 177 | 2,463 | **flag**: southern icefield toward Kololo Peaks |
| Honeycomb | 4,957 | 5,789 | 144 | 2,485 | **flag**: southern icefield toward Kololo Peaks |
| White River | 5,519 | 5,988 | 166 | 2,490 | **flag**: southern icefield toward Kololo Peaks |

DEM check (Copernicus GLO-30 heads against GNIS summits, analysis only, added
after the first review): Chocolate, Kennedy, Sitkum, Cool, Scimitar, Dusty,
North Guardian, Ermine and Vista head on Glacier Peak itself. **Ptarmigan**
heads 35 m from Kennedy Peak (2,512 m) and **Gerdine** 156 m from
Disappointment Peak (2,964 m); both are sub-summits on Glacier Peak's ridges,
so Glacier Peak stays the proposal and both are flagged. Milk Lake heads at
2,106 m with no summit within 1.7 km. The southern-icefield heads (2,426–2,495
m) have no GNIS summit within 4 km. The Dakobed glaciers head on Clark
Mountain (Clark, Richardson, Pilz, Butterfly) and Tenpeak Mountain (Tenpeak,
Moth), confirming they belong to the North Cascades package.

USGS and the inventory treat Honeycomb, Suiattle, White Chuck and White River
as Glacier Peak glaciers; their heads lie on the icefield south of the cone,
toward the Kololo Peaks. Proposed parent: Glacier Peak, flagged. No "range"
parent.

## Containing area

All 16 → **Glacier Peak Wilderness** (`wilderness`); USFS EDW boundary,
smallest margin 7.5 km (Milk Lake; the selected Ptarmigan inventory outline also passed the fixture coverage check), so coverage is not in doubt.

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4; fixtures Glacier Peak and the EDW wilderness polygon.
Import, replay unchanged; a fixture line from the SE over Cool Glacier to the
summit crosses Cool (1,561 m) and Chocolate (176 m) in route and session;
backfill drained. `glacier-region-verify.sql`: all missing-row queries empty;
credits OSM 15 (2026-07-15) and PSU 1 (2015-09-09). Search: "white chuck",
"ptarmigan", "sitkum" find their glaciers; the route gains "cool glacier" and
"chocolate glacier".
