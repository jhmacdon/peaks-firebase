# North Cascades (north) glaciers — review packet, 2026-10-29

**23 glaciers. Flags: 2 ratio (2 of 25 named OSM glaciers, 8%), 6 no facts,
2 held.** Under the 2026-10-29 policy only ratio and outline-quality flags
count towards the 15% stop rule; glaciers with no inventory row are imported
with null facts; the Noisy Creek / Green Lake pair stays held until verified
identities arrive. Spec:
`cloud-sql/migrate/src/import-north-cascades-north-glaciers.ts`. Decisions:
[Markdown](north-cascades-north-glacier-outline-decisions-2026-10-29.md),
[JSON](north-cascades-north-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`fae62d072007f11fe4b6699094afaa34fba666185b256e8651b0eb368fc36a77`.

North Cascades split: this package (Shuksan, Pickets, Spickard, Redoubt,
Jack and Crater mountains, Bacon, Ruth/Icy, Colonial, Table Mountain, Twin
Sisters); a south package (park south unit, Lake Chelan, Dome/Chickamin,
Neve); a Glacier Peak Wilderness edges package; an Alpine Lakes/Stuart
package. Together they exceed ~60 glaciers.

## Sources and licences

| Source | Use | Licence | SHA-256 |
| --- | --- | --- | --- |
| OSM `natural=glacier`, mirror `overpass.kumi.systems`, bbox 48.65,-122.05,49.00,-120.60; base 2026-06-01T08:52:28Z | Outlines | ODbL-1.0 | `8749a8cd…ba0c` |
| Fountain, Glenn & McNeil (2023) via GLIMS WFS, cohort 2015-09-09 / 814 / PSU (391) | Area facts, outline candidate | CC0-1.0 | `33ecc358…a02e` |
| Same file, 744 cohorts 1958–1985 | Historical references | not cleared | same |
| RGI 7.0 via GLIMS WFS (1958–85 outlines) | Head elevation | CC BY 4.0 | `5ec768cb…1a4e` |
| GNIS, Copernicus GLO-30 DEM, NPS (NOCA, ROLA, LACH) and USFS EDW boundaries | Analysis only | public domain / Copernicus attribution | not committed |

No NPS North Cascades glacier outlines are used (outline data stays OSM/PSU).
GNIS lists no named glacier in this box (outside Baker) that OSM lacks.

## Roster: 23 places

Left out of the box's 40 named OSM glaciers: Baker's 14 (applied package);
Neve (south package); held back, flagged:

| OSM | Name | Why |
| --- | --- | --- |
| relation:15353262 | Noisy Creek Glacier | The inventory's "Noisy Creek Glacier" lies 91% on OSM's Green Lake polygon, not on this one. |
| relation:15353766 | Green Lake Glacier | As above; GNIS names neither, so no source settles which name is right. |

## Outline decisions

All 23 keep OSM. Flagged:
- **Ratio (2, counted):** outside the band, no dated evidence and no better
  candidate: Whatcom (OSM/facts 1.720), West Nooksack (5.512; the cohort's
  "West Nooksack Glacier" is a 0.019 km² part).
- **No facts (6, not counted):** no named row in any cleared PSU cohort;
  imported with null facts: Table Mountain, Sisters, Ruth, Diobsud,
  Spillway, Lower Price.
- **Held (2):** Noisy Creek, Green Lake (above).

| Glacier | OSM km² | GLIMS 2015 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Challenger | 4.187 | 3.592 | 3.592 | 1.166 | 0.826 / 0.980 | osm |
| Sulphide | 3.439 | 3.145 | 3.145 | 1.094 | 0.893 / 0.988 | osm |
| Crystal | 2.275 | 2.144 | 2.144 | 1.061 | 0.922 / 0.988 | osm |
| Redoubt | 2.181 | 2.165 | 2.165 | 1.008 | 0.938 / 0.972 | osm |
| East Nooksack | 1.883 | 1.613 | 1.613 | 1.167 | 0.639 / 0.845 | osm |
| Nohokomeen | 1.588 | 1.477 | 1.477 | 1.075 | 0.841 / 0.948 | osm |
| Price | 0.862 | 1.130 | 1.130 | 0.763 | 0.519 / 0.602 | osm |
| Colonial | 0.560 | 0.560 | 0.560 | 1.000 | 0.796 / 0.887 | osm |
| Terror | 0.519 | 0.477 | 0.477 | 1.088 | 0.823 / 0.943 | osm |
| Lower Curtis | 0.466 | 0.425 | 0.425 | 1.096 | 0.877 / 0.979 | osm |
| Hanging | 0.450 | 0.408 | 0.408 | 1.103 | 0.731 / 0.888 | osm |
| Silver | 0.411 | 0.329 | 0.329 | 1.249 | 0.767 / 0.976 | osm |
| White Salmon (Shuksan) | 0.399 | 0.334 | 0.334 | 1.192 | 0.802 / 0.976 | osm |
| Upper Curtis | 0.384 | 0.395 | 0.395 | 0.972 | 0.785 / 0.867 | osm |
| Whatcom | 0.250 | 0.145 | 0.145 | 1.720 | 0.564 / 0.981 | osm ⚑ |
| Jerry | 0.144 | 0.188 | 0.188 | 0.763 | 0.718 / 0.737 | osm |
| West Nooksack | 0.104 | 0.019 | 0.019 | 5.512 | 0.166 / 0.929 | osm ⚑ |
| Diobsud | 1.108 | — | — | — | — | osm ⚑ no facts |
| Sisters | 0.873 | — | — | — | — | osm ⚑ no facts |
| Lower Price | 0.444 | — | — | — | — | osm ⚑ no facts |
| Ruth | 0.211 | — | — | — | — | osm ⚑ no facts |
| Spillway | 0.056 | — | — | — | — | osm ⚑ no facts |
| Table Mountain | 0.033 | — | — | — | — | osm ⚑ no facts |

## Parent mountain (DEM head → GNIS summit)

| Parent (GNIS lat, lng) | Glaciers (distance head→summit) | Calls |
| --- | --- | --- |
| Mount Shuksan (48.8311, -121.6030), 3000 m | Sulphide 137 m, Crystal 224 m, Hanging 255 m, Upper Curtis 374 m, Price 781 m, East Nooksack 944 m, White Salmon 864 m, Lower Curtis (The Hourglass 586 m), West Nooksack (Nooksack Tower 841 m), Lower Price (Nooksack Tower 1.0 km) | ⚑ Lower Curtis, West Nooksack, Lower Price, East Nooksack: heads low or nearer a Shuksan satellite |
| Ruth Mountain (48.8600, -121.5328) | Ruth 18 m | clear |
| Icy Peak (48.8364, -121.5281) | Spillway 185 m | clear |
| Mount Redoubt (48.9578, -121.3010) | Redoubt 227 m | clear |
| Mount Spickard (48.9695, -121.2405) | Silver 66 m | clear |
| Mount Challenger (48.8364, -121.3421) | Challenger 136 m | clear |
| Whatcom Peak (48.8576, -121.3742) | Whatcom 183 m | clear |
| Mount Degenhardt (48.7715, -121.2946) | Terror 147 m | ⚑ icefield below Degenhardt, Terror and Inspiration |
| Jack Mountain (48.7728, -120.9565) | Nohokomeen 208 m | clear |
| Crater Mountain (48.7391, -120.9202) | Jerry 174 m | clear |
| Bacon Peak (48.6641, -121.5192) | Diobsud 131 m | clear |
| Colonial Peak (48.6615, -121.1221) | Colonial 958 m | ⚑ head 958 m from the summit |
| Table Mountain (48.8480, -121.7133) | Table Mountain 372 m | clear |
| South Twin (48.7049, -121.9876) | Sisters 103 m | ⚑ GNIS also has "Twin Sisters Mountain" 206 m away; the Peaks row may use either |

Radius 1,500 m except Shuksan. Features checked: `summit`. "Of N": Shuksan 9;
every other parent with a cohort row 1; Ruth, Icy, Table Mountain and Twin
Sisters have none (no "of N"). Bacon counts the inventory's Noisy Creek.

## Containers

**North Cascades National Park** (`national_park`) for 16 (smallest margin
Sulphide 255 m); **Pasayten Wilderness** for Nohokomeen and Jerry. None:
Lower Curtis (touches the park line), Ruth and Shuksan's White Salmon (split
between the park and Mount Baker Wilderness), Sisters (1 m margin), Table
Mountain (no federal area).

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4; 14 parent fixtures, NPS park and EDW Pasayten
polygons. Import, replay unchanged; a line up Shuksan crosses Crystal twice;
backfill drained; verify SQL per parent: all missing-row queries empty.

## Decisions applied (2026-10-29)

1. The six unnamed-in-PSU glaciers are imported with null facts, flagged
   "no facts", not counted. No other cleared PSU cohort names them.
2. Whatcom and West Nooksack keep OSM with the flag (no better candidate).
3. Noisy Creek / Green Lake stay held until verified identities arrive.
4. Parents (including Sisters: currently South Twin) keep the DEM-head
   method; researched corrections will be applied when they arrive.
