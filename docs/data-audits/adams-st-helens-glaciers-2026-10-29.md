# Mount Adams and Mount St. Helens glaciers — review packet, 2026-10-29

**Adams: 10 glaciers; flags 0 ratio, 0 no facts, 3 held** (1 outline-quality
problem counted: 1 of 13, 8%; the Avalanche/White Salmon pair stays held
until their identities are verified). **St. Helens: 1 glacier, no flags.**
Two packages, one apply each:
`import-adams-glaciers.ts` and `import-st-helens-glaciers.ts`. Both read
byte-identical copies of one snapshot set (box 46.13,-122.26,46.27,-121.38).
Decisions: [Adams](adams-glacier-outline-decisions-2026-10-29.md),
[St. Helens](st-helens-glacier-outline-decisions-2026-10-29.md).

| Package | Reviewed manifest SHA-256 (platform-stable) |
| --- | --- |
| Mount Adams | `c1108988a040ecede5ffd1f81c4a27e1bd0ae6da078af210f7868c5b4e4f3967` |
| Mount St. Helens | `71c1d7fe95dee1a238685ccae4c44c67b801e5464947a5c153d9786e6eee31b7` |

Both hashes changed with the hole-contact fix (#285): the 1969 Pinnacle
Glacier reference outline (GLIMS feature 762530) touches its exterior twice
and is now rejected as invalid. It was dated extent evidence only; Pinnacle
keeps OSM (ratio 1.292, in band) and no decision, geometry or fact changed.

## Sources and licences

| Source | Use | Licence | SHA-256 |
| --- | --- | --- | --- |
| OSM `natural=glacier`, mirror `overpass.private.coffee`; base 2026-05-31T22:37:44Z | Outlines | ODbL-1.0 | `695902c6…84de` |
| Fountain, Glenn & McNeil (2023) via GLIMS WFS; Adams cohort 2019-08-31 / 814 (48), St. Helens cohort 2019-09-09 / 814 (2) | Area facts, outline candidates | CC0-1.0 | `cc0dea77…d5ad7` |
| Same file, 1969 and 1980 / 744 | Historical references only | not cleared | same |
| Same file, 2015-09-09 / 814 at St. Helens (5) | Not used (one cohort per mountain; see St. Helens) | — | same |
| RGI 7.0 via GLIMS WFS (Adams 1969, St. Helens 1980 outlines) | Head elevation | CC BY 4.0 | `905edd55…0c96` |
| USGS GNIS, Copernicus GLO-30 DEM, USFS EDW wilderness and national-designation boundaries | Analysis only (names, heads, coverage) | public domain / Copernicus attribution / public domain | not committed |

## Mount Adams

10 places, parent **Mount Adams** (`summit`, `volcano`; 46.2024, -121.4908;
3000 m). Cohort 2019-08-31, "of 12" (includes Avalanche and White Salmon).
"White Salmon  Glacier" (double space) is counted as a third White Salmon
part (normalised names, #277).

Held back (flagged; need an OSM fix). The swapped pair stays held until
verified identities arrive (policy 2026-10-29); the duplicate Mazama is an
outline-quality flag:

| OSM | Name | Why |
| --- | --- | --- |
| relation:4104274 | Avalanche Glacier | Names swapped: this polygon holds the GNIS White Salmon point and 57–98% of the inventory's White Salmon parts. |
| relation:4104279 | White Salmon Glacier | Names swapped: holds the GNIS Avalanche point and 94% of the inventory's Avalanche. |
| relation:18735239 | Mazama Glacier | Second relation with the same GNIS id (1522832); no overlap with the inventory's Mazama, which matches relation:18735240. |

| Glacier | OSM km² | GLIMS 2019 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Adams | 4.912 | 3.867 | 3.867 | 1.270 | 0.747 / 0.971 | osm |
| Klickitat | 3.034 | 2.579 | 2.579 | 1.176 | 0.743 / 0.928 | osm |
| Wilson | 1.421 | 1.694 | 1.694 | 0.839 | 0.746 / 0.786 | osm |
| Lyman | 2.461 | 1.441 | 1.441 | 1.708 | 0.543 / 0.953 | **GLIMS 2019** (1969 reference fits OSM better) |
| Rusk | 1.174 | 1.239 | 1.239 | 0.947 | 0.910 / 0.928 | osm |
| Lava | 1.568 | 1.172 | 1.172 | 1.338 | 0.725 / 0.983 | osm |
| Pinnacle | 1.369 | 1.060 | 1.060 | 1.292 | 0.540 / 0.804 | osm |
| Mazama | 0.694 | 0.858 | 0.858 | 0.809 | 0.732 / 0.765 | osm |
| Crescent | 0.183 | 0.207 | 0.207 | 0.885 | 0.633 / 0.731 | osm |
| Gotchen | 0.367 | 0.102 | 0.102 | 3.609 | 0.276 / 0.997 | **GLIMS 2019** (1969 reference fits OSM better) |

No outline flags. RGI 1969 has no "Avalanche Glacier" row (`rgi_absent`).

| Glacier | DEM head (m) | Nearest summit to head | Call |
| --- | ---: | --- | --- |
| Adams, Lyman | 3,735 | Mount Adams 38 m | clear |
| Klickitat | 3,672 | Mount Adams 303 m | clear |
| Rusk | 3,167 | Mount Adams 872 m | clear |
| Wilson | 3,221 | Mount Adams 1.2 km | clear |
| Pinnacle | 3,271 | Mount Adams 1.5 km | clear |
| Mazama | 3,393 | Pikers Peak (Adams' false summit) 448 m | clear |
| Lava | 2,963 | North Cleaver ridge 340 m; Mount Adams 1.9 km | ⚑ north flank, low head |
| Crescent | 2,825 | Pikers Peak 1.7 km | ⚑ south side below Pikers Peak |
| Gotchen | 2,613 | Pikers Peak 2.9 km | ⚑ low south flank |

Containers (USFS EDW Mount Adams Wilderness): **Mount Adams Wilderness** for
Crescent (margin 450 m), Lava (986 m) and Pinnacle (1,480 m). No container for
Adams (99.5% inside) and Gotchen (99.2%), which cross the line, nor for
Klickitat, Lyman, Mazama, Rusk and Wilson, which lie largely or wholly on
Yakama Nation land (no federal area).

## Mount St. Helens

Per Josiah's note (2026-10-29): Crater Glacier is the mountain's only current
glacier. 1 place, parent **Mount St. Helens** (`summit`, `volcano`; 46.1912,
-122.1944; 3000 m; GNIS spells it "Mount Saint Helens", Peaks uses "St.").
Container **Mount St. Helens National Volcanic Monument** (`national_monument`;
EDW boundary, margin 4.5 km). Alias `Tulutson Glacier` from OSM `alt_name`.

Cohort 2019-09-09 / 814 (Crater's only cohort): 1.740 km², rank 1 of 1. OSM
1.682 km², ratio 0.967: OSM kept. Head elevation null: RGI 7.0 maps St. Helens
from 1980, before Crater Glacier formed. DEM head 2,447 m, 91 m from the summit.

For checking — the sources disagree with "Crater only":

| Source | Still lists |
| --- | --- |
| OSM (one 2019 GNIS-sourced edit) | Ape, Dryer, Forsyth, Nelson, Shoestring, Swift, Talus ×2, Toutle |
| PSU 2015-09-09 cohort (CC0) | Dryer 0.012 km², Swift 0.056, Talus 0.108, Toutle 0.045 |
| RGI 7.0 (1980) | Ape, Dryer, Forsyth, Nelson, Shoestring, Swift, Talus, Toutle |
| GNIS | the same names plus Leschi, Loowit, Wishbone (marked historical) |

None is imported. If some remnants still count as glaciers, they can be added
to this package with the 2015 cohort (a separate decision: two cohorts on one
mountain).

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4, real EDW boundaries as fixture areas.
- Adams: import, replay unchanged; a line up the east side crosses Klickitat
  (436 m) and Adams (121 m) in route and session; backfill drained; verify SQL
  (10 places, 7 uncontained listed): all missing-row queries empty.
- St. Helens: import, replay unchanged; a line from the crater floor to the
  summit crosses Crater twice; verify SQL clean; "crater glacier" finds it and
  the route gains "crater glacier" and "tulutson glacier".
