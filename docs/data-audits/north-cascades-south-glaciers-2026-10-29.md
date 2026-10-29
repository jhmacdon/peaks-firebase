# North Cascades (south) glaciers — review packet, 2026-10-29

**42 glaciers. Flags: 0 ratio, 7 no facts, 0 held.** Outline rule 2 (#290). Under the
2026-10-29 policy only ratio and outline-quality flags count towards the 15%
stop rule; glaciers with no inventory row are imported with null facts.
Spec:
`cloud-sql/migrate/src/import-north-cascades-south-glaciers.ts`. Decisions:
[Markdown](north-cascades-south-glacier-outline-decisions-2026-10-29.md),
[JSON](north-cascades-south-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`53ac3102b365d089a7005aca22151c59acad3a8fea56b27c05255cd9279d4e2e`.

Scope: North Cascades National Park south unit (Eldorado, Boston Basin,
Logan, Klawatti), Lake Chelan NRA edge, and the Dome/Chickamin, Spider and
Snowking groups in Glacier Peak Wilderness. All 42 named OSM glaciers in the
box (48.30,-121.60,48.65,-120.60) are places, including Neve (also in the
north box).

## Sources and licences

| Source | Use | Licence | SHA-256 |
| --- | --- | --- | --- |
| OSM `natural=glacier`, mirror `overpass.kumi.systems`; base 2026-06-01T08:52:28Z | Outlines | ODbL-1.0 | `fb3cf82b…2c4a` |
| Fountain, Glenn & McNeil (2023) via GLIMS WFS, cohort 2015-09-09 / 814 / PSU (308) | Area facts, outline candidate | CC0-1.0 | `0a5424ce…2284` |
| Same file, 2017-09-09 / 814 / PSU (80) | Area facts for Goode, LeConte, Sandalee and South Cascade only (each the only named 2017 glacier of its parent; one cohort per glacier) | CC0-1.0 | same |
| USGS Benchmark Glacier Project, compiled input data and glacier-wide mass balances, ver 10.0 (March 2026), [doi:10.5066/F7HD7SRF](https://doi.org/10.5066/F7HD7SRF) | South Cascade area: 2021-08-13 DEM year, 1.799572 km² (PSU 2017 1.777 kept as cross-check) | CC0-1.0 (`usgs-benchmark/LICENCE-EVIDENCE.txt`) | area-altitude `d4bc541b…b149`, geodetics `50430e01…d611` |
| Same file, 744 cohorts 1958–1985 | Historical references | not cleared | same |
| RGI 7.0 via GLIMS WFS (1958–85 outlines) | Head elevation | CC BY 4.0 | `ec1beba9…4f47` |
| GNIS, Copernicus GLO-30 DEM, NPS and USFS EDW boundaries | Analysis only | public domain / Copernicus attribution | not committed |

GNIS names three glaciers here that OSM lacks: **LeConte** (OSM spells it
"Le Conte"; same glacier), **Lewis** and **South Glacier** (no OSM polygon;
both in the 2015 cohort and counted towards "of N" at Frisco Mountain and
Hurry-up Peak by proximity, flagged).

## Flags

- **Ratio (0).** Lyall (1.545), Thunder (1.510), Douglas (1.523) and Yawning
  (1.621) take the PSU 2015 outline under outline rule 2 (OSM extents are
  undated; the inventory is dated and closer to the facts area).
- **No facts (7), not counted:** no named row in any cleared PSU cohort;
  imported with every fact null: Backbone, Cache, Goat Creek, Kindy,
  Mutchler, Perdition, Snowking.
- **Held (0).**
- Facts from another cohort (not flags): Goode (2017, ratio 0.805), Le Conte
  (2017 "LeConte Glacier", 0.955), Sandalee (2017, 0.990), South Cascade
  (USGS 2021, 0.937). Their parents each get `of 1`. Sandalee's head
  elevation uses the highest of its three 1958 RGI rows, as Thunder's and
  Yawning's do.

## Decision table, parents and containers

Parents are the GNIS summit nearest each glacier's DEM head; radius 1,500 m;
features checked `summit`.

| Glacier | OSM km² | GLIMS 2015 | Facts km² (year) | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Boston Glacier | 5.913 | 6.064 | 6.064 | 0.975 | 0.953 / 0.964 | osm |
| McAllister Glacier | 4.284 | 4.368 | 4.368 | 0.981 | 0.889 / 0.932 | osm |
| Inspiration Glacier | 4.555 | 4.110 | 4.110 | 1.108 | 0.799 / 0.936 | osm |
| Chickamin Glacier | 3.811 | 3.970 | 3.970 | 0.960 | 0.911 / 0.934 | osm |
| Neve Glacier | 3.946 | 3.822 | 3.822 | 1.032 | 0.916 / 0.972 | osm |
| Dana Glacier | 2.010 | 2.141 | 2.141 | 0.939 | 0.904 / 0.921 | osm |
| Le Conte Glacier | 1.819 | — | 1.904 (2017) | 0.955 | — / — | osm |
| Klawatti Glacier | 1.807 | 1.841 | 1.841 | 0.981 | 0.953 / 0.967 | osm |
| Eldorado Glacier | 1.271 | 1.814 | 1.814 | 0.701 | 0.589 / 0.631 | osm |
| South Cascade Glacier | 1.687 | — | 1.800 (2021) | 0.937 | — / — | osm |
| North Klawatti Glacier | 1.424 | 1.335 | 1.335 | 1.067 | 0.899 / 0.978 | osm |
| Forbidden Glacier | 1.130 | 1.231 | 1.231 | 0.918 | 0.861 / 0.887 | osm |
| Middle Cascade Glacier | 1.123 | 1.060 | 1.060 | 1.059 | 0.884 / 0.966 | osm |
| Dome Glacier | 0.973 | 0.998 | 0.998 | 0.975 | 0.959 / 0.967 | osm |
| Fremont Glacier | 0.910 | 0.831 | 0.831 | 1.096 | 0.884 / 0.983 | osm |
| Borealis Glacier | 0.796 | 0.732 | 0.732 | 1.087 | 0.833 / 0.949 | osm |
| Katsuk Glacier | 0.726 | 0.723 | 0.723 | 1.004 | 0.953 / 0.978 | osm |
| Quien Sabe Glacier | 0.736 | 0.708 | 0.708 | 1.039 | 0.872 / 0.950 | osm |
| Spire Glacier | 0.741 | 0.688 | 0.688 | 1.077 | 0.884 / 0.975 | osm |
| Douglas Glacier | 1.008 | 0.662 | 0.662 | 1.523 | 0.526 / 0.870 | **GLIMS 2015** (rule 2) |
| Kimtah Glacier | 0.543 | 0.639 | 0.639 | 0.851 | 0.808 / 0.827 | osm |
| Wyeth Glacier | 0.487 | 0.523 | 0.523 | 0.932 | 0.785 / 0.849 | osm |
| Goode Glacier | 0.388 | — | 0.482 (2017) | 0.805 | — / — | osm |
| Buckner Glacier | 0.460 | 0.452 | 0.452 | 1.016 | 0.885 / 0.946 | osm |
| Spider Glacier | 0.431 | 0.428 | 0.428 | 1.007 | 0.807 / 0.896 | osm |
| Sandalee Glacier | 0.408 | — | 0.412 (2017) | 0.990 | — / — | osm |
| Mesahchie Glacier | 0.351 | 0.374 | 0.374 | 0.939 | 0.898 / 0.917 | osm |
| Davenport Glacier | 0.269 | 0.350 | 0.350 | 0.767 | 0.745 / 0.755 | osm |
| Banded Glacier | 0.284 | 0.277 | 0.277 | 1.024 | 0.824 / 0.914 | osm |
| Blue Glacier | 0.234 | 0.225 | 0.225 | 1.044 | 0.918 / 0.978 | osm |
| S Glacier | 0.233 | 0.163 | 0.163 | 1.426 | 0.622 / 0.930 | osm |
| Sahale Glacier | 0.156 | 0.149 | 0.149 | 1.045 | 0.717 / 0.854 | osm |
| Thunder Glacier | 0.198 | 0.131 | 0.131 | 1.510 | 0.591 / 0.933 | **GLIMS 2015** (rule 2) |
| Yawning Glacier | 0.201 | 0.124 | 0.124 | 1.621 | 0.469 / 0.837 | **GLIMS 2015** (rule 2) |
| Lyall Glacier | 0.046 | 0.030 | 0.030 | 1.545 | 0.450 / 0.790 | **GLIMS 2015** (rule 2) |
| Cache Glacier | 0.196 | — | — | — | — / — | osm ⚑ no facts |
| Perdition Glacier | 0.248 | — | — | — | — / — | osm ⚑ no facts |
| Kindy Glacier | 0.562 | — | — | — | — / — | osm ⚑ no facts |
| Backbone Glacier | 0.970 | — | — | — | — / — | osm ⚑ no facts |
| Snowking Glacier | 0.942 | — | — | — | — / — | osm ⚑ no facts |
| Mutchler Glacier | 0.819 | — | — | — | — / — | osm ⚑ no facts |
| Goat Creek Glacier | 0.567 | — | — | — | — / — | osm ⚑ no facts |

| Glacier | Parent | DEM head (m) | Nearest GNIS summit to head | Container |
| --- | --- | ---: | --- | --- |
| Backbone Glacier | Eldorado Peak | 2193 | Tepeh Towers 3774 m | north-cascades-np |
| Eldorado Glacier | Eldorado Peak | 2524 | Eldorado Peak 449 m | north-cascades-np |
| Inspiration Glacier | Eldorado Peak | 2676 | Eldorado Peak 95 m | north-cascades-np |
| Perdition Glacier | Eldorado Peak | 2180 | Tepeh Towers 2469 m | north-cascades-np |
| McAllister Glacier | Austera Peak | 2502 | Austera Peak 86 m | north-cascades-np |
| North Klawatti Glacier | Austera Peak | 2456 | Austera Towers 908 m | north-cascades-np |
| Boston Glacier | Boston Peak | 2629 | Boston Peak 55 m | north-cascades-np |
| Davenport Glacier | Boston Peak | 2431 | Boston Peak 283 m | north-cascades-np |
| Buckner Glacier | Buckner Mountain | 2591 | Buckner Mountain 156 m | north-cascades-np |
| Thunder Glacier | Buckner Mountain | 2243 | Buckner Mountain 942 m | north-cascades-np |
| Chickamin Glacier | Dome Peak | 2684 | Dome Peak 78 m | glacier-peak-wilderness |
| Dana Glacier | Dome Peak | 2448 | Dome Peak 2670 m | glacier-peak-wilderness |
| Dome Glacier | Dome Peak | 2657 | Dome Peak 257 m | glacier-peak-wilderness |
| Spire Glacier | Dome Peak | 2431 | Dome Peak 3573 m | glacier-peak-wilderness |
| Forbidden Glacier | Forbidden Peak | 2486 | Forbidden Peak 573 m | north-cascades-np |
| Lyall Glacier | Frisco Mountain | 2082 | Frisco Mountain 681 m | — |
| Goode Glacier | Goode Mountain | 2380 | Goode Mountain 335 m | north-cascades-np |
| Blue Glacier | Gunsight Peak | 2426 | Gunsight Peak 151 m | glacier-peak-wilderness |
| S Glacier | Hurry-up Peak | 2355 | Hurry-up Peak 189 m | — |
| Katsuk Glacier | Katsuk Peak | 2503 | Katsuk Peak 279 m | north-cascades-np |
| Kimtah Glacier | Kimtah Peak | 2487 | Kimtah Peak 178 m | north-cascades-np |
| Klawatti Glacier | Klawatti Peak | 2523 | Klawatti Peak 49 m | north-cascades-np |
| South Cascade Glacier | Lizard Mountain | 2200 | Lizard Mountain 1199 m | glacier-peak-wilderness |
| Yawning Glacier | Magic Mountain | 2059 | Magic Mountain 242 m | north-cascades-np |
| Sandalee Glacier | McGregor Mountain | 2429 | McGregor Mountain 54 m | — |
| Mesahchie Glacier | Mesahchie Peak | 2463 | Mesahchie Peak 307 m | north-cascades-np |
| Cache Glacier | Mix-up Peak | 2122 | Mix-up Peak 814 m | — |
| Goat Creek Glacier | Mount Buckindy | 2151 | Mount Misch (not official) 345 m | glacier-peak-wilderness |
| Kindy Glacier | Mount Buckindy | 2150 | Mount Buckindy 146 m | glacier-peak-wilderness |
| Banded Glacier | Mount Logan | 2734 | Mount Logan 74 m | north-cascades-np |
| Douglas Glacier | Mount Logan | 2580 | Mount Logan 318 m | north-cascades-np |
| Fremont Glacier | Mount Logan | 2655 | Mount Logan 720 m | north-cascades-np |
| Le Conte Glacier | Old Guard Peak | 2447 | Old Guard Peak 53 m | glacier-peak-wilderness |
| Borealis Glacier | Primus Peak | 2401 | Primus Peak 274 m | north-cascades-np |
| Quien Sabe Glacier | Sahale Mountain | 2616 | Sahale Mountain 132 m | north-cascades-np |
| Sahale Glacier | Sahale Mountain | 2488 | Sahale Mountain 239 m | north-cascades-np |
| Neve Glacier | Snowfield Peak | 2449 | Snowfield Peak 1156 m | north-cascades-np |
| Mutchler Glacier | Snowking Mountain | 2162 | Snowking Mountain 3022 m | glacier-peak-wilderness |
| Snowking Glacier | Snowking Mountain | 2235 | Snowking Mountain 1034 m | glacier-peak-wilderness |
| Middle Cascade Glacier | Spider Mountain | 2421 | Spider Mountain 558 m | glacier-peak-wilderness |
| Spider Glacier | Spider Mountain | 2248 | Spider Mountain 537 m | glacier-peak-wilderness |
| Wyeth Glacier | Storm King | 2423 | Storm King 1027 m | north-cascades-np |

| Parent key | Name | lat, lng | radius | of N |
| --- | --- | --- | ---: | ---: |
| (default) | Eldorado Peak | 48.5376, -121.1343 | 1500 | 2 |
| austera-peak | Austera Peak | 48.5685, -121.1014 | 1500 | 2 |
| boston-peak | Boston Peak | 48.4958, -121.0358 | 1500 | 2 |
| buckner-mountain | Buckner Mountain | 48.4952, -120.9979 | 1500 | 2 |
| dome-peak | Dome Peak | 48.3035, -121.0291 | 1500 | 4 |
| forbidden-peak | Forbidden Peak | 48.5117, -121.0584 | 1500 | 1 |
| frisco-mountain | Frisco Mountain | 48.4887, -120.7568 | 1500 | 2 |
| goode-mountain | Goode Mountain | 48.4832, -120.9115 | 1500 | 1 |
| gunsight-peak | Gunsight Peak | 48.3067, -120.9946 | 1500 | 1 |
| hurry-up-peak | Hurry-up Peak | 48.434, -121.0379 | 1500 | 2 |
| katsuk-peak | Katsuk Peak | 48.5784, -120.8888 | 1500 | 1 |
| kimtah-peak | Kimtah Peak | 48.585, -120.9106 | 1500 | 1 |
| klawatti-peak | Klawatti Peak | 48.5543, -121.1046 | 1500 | 1 |
| lizard-mountain | Lizard Mountain | 48.3456, -121.0433 | 1500 | 1 |
| magic-mountain | Magic Mountain | 48.4457, -121.0411 | 1500 | 1 |
| mcgregor-mountain | McGregor Mountain | 48.4082, -120.7981 | 1500 | 1 |
| mesahchie-peak | Mesahchie Peak | 48.5785, -120.8804 | 1500 | 1 |
| mix-up-peak | Mix-up Peak | 48.454, -121.0603 | 1500 | — |
| mount-buckindy | Mount Buckindy | 48.3515, -121.2061 | 1500 | — |
| mount-logan | Mount Logan | 48.5368, -120.9526 | 1500 | 3 |
| old-guard-peak | Old Guard Peak | 48.356, -121.0358 | 1500 | 1 |
| primus-peak | Primus Peak | 48.5819, -121.0918 | 1500 | 1 |
| sahale-mountain | Sahale Mountain | 48.4911, -121.0385 | 1500 | 2 |
| snowfield-peak | Snowfield Peak | 48.6353, -121.1387 | 1500 | 1 |
| snowking-mountain | Snowking Mountain | 48.4082, -121.278 | 1500 | — |
| spider-mountain | Spider Mountain | 48.4094, -121.0361 | 1500 | 2 |
| storm-king | Storm King | 48.4912, -120.9303 | 1500 | 1 |

Parent calls checked by the reviewed research, all agreed (17 of 42; none unclear): Fremont (Logan 720 m), Spire (no summit
within 3.5 km; Dome Peak), Lyall (Frisco 681 m), Cache (Mix-up 814 m),
Perdition and Backbone (no summit near the head; Eldorado Peak), Neve
(Snowfield 1.2 km), Thunder (Buckner 942 m), Blue (Gunsight Peak, lower than
the head), Dana (Dome Peak 2.7 km), Snowking (1.0 km), Wyeth (Storm King
1.0 km), Mutchler (Snowking 3.0 km), Goat Creek (head at unofficial "Mount
Misch"; Mount Buckindy), South Cascade (Lizard 1.2 km), North Klawatti
(Austera 911 m), S Glacier (Hurry-up Peak, lower than the head).

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4 `_test` database; 28 parent fixtures, the NPS park
and EDW Glacier Peak Wilderness polygons. Import of all 42, replay
unchanged; a fixture line from Eldorado Peak crosses Perdition and Backbone
(route and session crossings); backfill drained; verify SQL per parent: all
missing-row queries empty; container links match the manifest exactly.

## Decisions applied (2026-10-29)

1. Null-fact glaciers imported and flagged "no facts"; not counted.
2. Goode, LeConte, Sandalee, South Cascade take 2017-09-09 cohort facts
   (#286); South Cascade's area is the USGS benchmark 2021 DEM area, and its
   facts row credits the USGS release (doi:10.5066/F7HD7SRF) and RGI 7.0
   (#288); every other glacier credits PSU and RGI 7.0.
   The reviewed research suggested the USGS web page's "1.8 km² (2015)" and
   an elevation span of "~660 m". That page answers 504 to this network
   (not worked around), and its 2015 figure is the same release's 2015
   reference DEM (1.822804 km²); the 2021 DEM year of the same CC0 release
   is more recent, so it is used. The release gives only 50 m area bins, not
   explicit head or terminus elevations, so the elevation span stays null
   and the head elevation stays RGI `zmax_m`.
3. Lyall, Thunder, Douglas, Yawning take the PSU 2015 outline (rule 2).
4. Parents: nearest GNIS summit to the DEM head; the reviewed research
   checked every flagged call and agreed.

## Outline overlaps (neighbour check, #290)

After sources were chosen, every pair of final outlines in each package was
measured. No pair overlaps by more than 1% of the smaller outline or 0.01 km²,
so no group was moved to one source and nothing was clipped. Resolution:
none needed. The decision reports' "Outline overlaps" section records the
same result.
