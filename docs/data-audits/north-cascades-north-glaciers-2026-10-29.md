# North Cascades (north) glaciers — review packet, 2026-10-29

**25 glaciers. Flags: 0 ratio, 8 no facts, 0 held.** Outline rule 2 (#290): Whatcom and West Nooksack take the dated PSU 2015 outline. Under the 2026-10-29 policy only ratio and outline-quality flags
count towards the 15% stop rule; glaciers with no inventory row are imported
with null facts; the Noisy Creek / Green Lake pair stays held until verified
identities arrive. (Update: identities arrived; both are imported under
their OSM labels, see Roster.) Spec:
`cloud-sql/migrate/src/import-north-cascades-north-glaciers.ts`. Decisions:
[Markdown](north-cascades-north-glacier-outline-decisions-2026-10-29.md),
[JSON](north-cascades-north-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`e7ceff7820a5cd30bbce44afad066e78e9d52cbf50d4c34e4e552f0f3cb17b15`.

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

## Roster: 25 places

Left out of the box's 40 named OSM glaciers: Baker's 14 (applied package)
and Neve (south package).

**Noisy Creek and Green Lake (Bacon Peak).** Reviewed identities (Wikipedia,
NPS monitoring no. 2219-1): Noisy Creek Glacier lies northwest of Bacon Peak
and Green Lake Glacier northeast. Method: each OSM polygon's centroid against
the GNIS Bacon Peak summit (1516025, 48.66405,-121.51917). OSM "Noisy Creek"
(relation:15353262, centroid 48.67215,-121.52715) is NW; OSM "Green Lake"
(relation:15353766, centroid 48.67126,-121.50759) is NE. Both OSM labels
agree, so no label correction. Neither takes inventory facts: the PSU 2015
cohort's only named row there, "Noisy Creek Glacier", lies 91% on the
Green Lake polygon (the inventory's name is wrong), and the NW polygon holds
only an unnamed row. Both are flagged "no facts"; parent Bacon Peak (DEM
heads 805 m and 331 m from it); container North Cascades National Park.
The Wikipedia reference point for Green Lake (48.66361,-121.52028) falls on
Diobsud Glacier, so it was not used.

## Outline decisions

23 keep OSM; Whatcom and West Nooksack take the PSU 2015 outline. Flagged:
- **Ratio (0).** Whatcom (OSM/facts 1.720) and West Nooksack (5.512; the
  cohort's "West Nooksack Glacier" is a 0.019 km² part) switch to the PSU
  2015 outline under outline rule 2 (OSM extents are undated; the inventory
  is dated and closer to the facts area).
- **No facts (8, not counted):** no usable named row in any cleared PSU
  cohort; imported with null facts: Table Mountain, Sisters, Ruth, Diobsud,
  Spillway, Lower Price, Noisy Creek, Green Lake.
- **Held (0).**

| Glacier | OSM km² | GLIMS 2015 | Facts km² (year) | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Challenger Glacier | 4.187 | 3.592 | 3.592 | 1.166 | 0.826 / 0.980 | osm |
| Sulphide Glacier | 3.439 | 3.145 | 3.145 | 1.094 | 0.893 / 0.988 | osm |
| Redoubt Glacier | 2.181 | 2.165 | 2.165 | 1.008 | 0.938 / 0.972 | osm |
| Crystal Glacier | 2.275 | 2.144 | 2.144 | 1.061 | 0.922 / 0.988 | osm |
| East Nooksack Glacier | 1.883 | 1.613 | 1.613 | 1.167 | 0.639 / 0.845 | osm |
| Nohokomeen Glacier | 1.588 | 1.477 | 1.477 | 1.075 | 0.841 / 0.948 | osm |
| Price Glacier | 0.862 | 1.130 | 1.130 | 0.763 | 0.519 / 0.602 | osm |
| Colonial Glacier | 0.560 | 0.560 | 0.560 | 1.000 | 0.796 / 0.887 | osm |
| Terror Glacier | 0.519 | 0.477 | 0.477 | 1.088 | 0.823 / 0.943 | osm |
| Lower Curtis Glacier | 0.466 | 0.425 | 0.425 | 1.096 | 0.877 / 0.979 | osm |
| Hanging Glacier | 0.450 | 0.408 | 0.408 | 1.103 | 0.731 / 0.888 | osm |
| Upper Curtis Glacier | 0.384 | 0.395 | 0.395 | 0.972 | 0.785 / 0.867 | osm |
| White Salmon Glacier | 0.399 | 0.334 | 0.334 | 1.192 | 0.802 / 0.976 | osm |
| Silver Glacier | 0.411 | 0.329 | 0.329 | 1.249 | 0.767 / 0.976 | osm |
| Jerry Glacier | 0.144 | 0.188 | 0.188 | 0.763 | 0.718 / 0.737 | osm |
| Whatcom Glacier | 0.250 | 0.145 | 0.145 | 1.720 | 0.564 / 0.981 | **GLIMS 2015** (rule 2) |
| West Nooksack Glacier | 0.104 | 0.019 | 0.019 | 5.512 | 0.166 / 0.929 | **GLIMS 2015** (rule 2) |
| Table Mountain Glacier | 0.033 | — | — | — | — / — | osm ⚑ no facts |
| Sisters Glacier | 0.873 | — | — | — | — / — | osm ⚑ no facts |
| Ruth Glacier | 0.211 | — | — | — | — / — | osm ⚑ no facts |
| Diobsud Glacier | 1.108 | — | — | — | — / — | osm ⚑ no facts |
| Spillway Glacier | 0.056 | — | — | — | — / — | osm ⚑ no facts |
| Lower Price Glacier | 0.444 | — | — | — | — / — | osm ⚑ no facts |
| Noisy Creek Glacier | 0.414 | — | — | — | — / — | osm ⚑ no facts |
| Green Lake Glacier | 1.468 | — | — | — | — / — | osm ⚑ no facts |

## Parent mountain (DEM head → GNIS summit)

| Parent (GNIS lat, lng) | Glaciers (distance head→summit) | Calls |
| --- | --- | --- |
| Mount Shuksan (48.8311, -121.6030), 3000 m | Sulphide 137 m, Crystal 224 m, Hanging 255 m, Upper Curtis 374 m, Price 781 m, East Nooksack 944 m, White Salmon 864 m, Lower Curtis (The Hourglass 586 m), West Nooksack (Nooksack Tower 841 m), Lower Price (Nooksack Tower 1.0 km) | checked: Lower Curtis, West Nooksack, Lower Price, East Nooksack (heads low or nearer a Shuksan satellite) |
| Ruth Mountain (48.8600, -121.5328) | Ruth 18 m | clear |
| Icy Peak (48.8364, -121.5281) | Spillway 185 m | clear |
| Mount Redoubt (48.9578, -121.3010) | Redoubt 227 m | clear |
| Mount Spickard (48.9695, -121.2405) | Silver 66 m | clear |
| Mount Challenger (48.8364, -121.3421) | Challenger 136 m | clear |
| Whatcom Peak (48.8576, -121.3742) | Whatcom 183 m | clear |
| Mount Degenhardt (48.7715, -121.2946) | Terror 147 m | checked (icefield below Degenhardt, Terror and Inspiration) |
| Jack Mountain (48.7728, -120.9565) | Nohokomeen 208 m | clear |
| Crater Mountain (48.7391, -120.9202) | Jerry 174 m | clear |
| Bacon Peak (48.6641, -121.5192) | Diobsud 131 m, Green Lake 331 m, Noisy Creek 805 m | clear (both on Bacon Peak's north side) |
| Colonial Peak (48.6615, -121.1221) | Colonial 958 m | checked (head 958 m from the summit) |
| Table Mountain (48.8480, -121.7133) | Table Mountain 372 m | clear |
| South Twin (48.7049, -121.9876) | Sisters 103 m | checked (GNIS also has "Twin Sisters Mountain" 206 m away; the Peaks row may use either) |

Radius 1,500 m except Shuksan. Features checked: `summit`. "Of N": Shuksan 9;
every other parent with a cohort row 1; Ruth, Icy, Table Mountain and Twin
Sisters have none (no "of N"). Bacon counts the inventory's "Noisy Creek Glacier" row (which lies on Green Lake).

## Containers

**North Cascades National Park** (`national_park`) for 18 (smallest margin
Sulphide 255 m; Noisy Creek and Green Lake inside); **Pasayten Wilderness** for Nohokomeen and Jerry. None:
Lower Curtis (touches the park line), Ruth and Shuksan's White Salmon (split
between the park and Mount Baker Wilderness), Sisters (1 m margin), Table
Mountain (no federal area).

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4 `_test`; 14 parent fixtures, NPS park and EDW
Pasayten polygons. Re-run for the 25-place manifest: import, replay
unchanged, backfill drained; verify SQL per parent (Bacon Peak 3): all
missing-row queries empty; container links match the manifest exactly.

## Decisions applied (2026-10-29)

1. The six unnamed-in-PSU glaciers are imported with null facts, flagged
   "no facts", not counted. No other cleared PSU cohort names them.
2. Whatcom and West Nooksack take the PSU 2015 outline (outline rule 2).
3. Noisy Creek / Green Lake imported under their OSM labels, which match the
   reviewed sides of Bacon Peak; null facts.
4. Parents: the reviewed research checked every flagged call and agreed;
   none is unclear.

## Outline overlaps (neighbour check, #290)

After sources were chosen, every pair of final outlines in each package was
measured. No pair overlaps by more than 1% of the smaller outline or 0.01 km²,
so no group was moved to one source and nothing was clipped. Resolution:
none needed. The decision reports' "Outline overlaps" section records the
same result.
