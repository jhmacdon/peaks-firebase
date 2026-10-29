# Goat Rocks glaciers — review packet, 2026-10-29

**Draft: 4 glaciers; flags 2 ratio (2 of 4, 50%: over the 15% stop line),
0 no facts, 0 held.** Spec: `cloud-sql/migrate/src/import-goat-rocks-glaciers.ts`.
Decisions: [Markdown](goat-rocks-glacier-outline-decisions-2026-10-29.md),
[JSON](goat-rocks-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`64f399ee9c1290ae1b55cfdcdef0270823ffc9672a3466a5878aa5f3eb89b6f4`.

Scope: every named OSM `natural=glacier` in the box 46.40,-121.60,46.60,-121.35
(Goat Rocks). OSM has five glacier relations there; one is unnamed and left
out. GNIS lists the same four named glaciers (Conrad, McCall, Meade,
Packwood) and no other.

## Sources and licences

| Source | Use | Licence | SHA-256 |
| --- | --- | --- | --- |
| OSM `natural=glacier`, mirror `overpass.kumi.systems`; base 2026-07-15T15:22:01Z | Outlines | ODbL-1.0 | `c71051d9…` |
| Fountain, Glenn & McNeil (2023) via GLIMS WFS, cohort 2015-09-09 / 814 / PSU (35 analyses) | Area facts, outline candidate | CC0-1.0 | `50e7c718…` |
| Same file, 744 cohorts 1959 and 1969 | Historical references | not cleared | same |
| RGI 7.0 via GLIMS WFS (1959–69 outlines) | Head elevation | CC BY 4.0 | `e1af554e…` |
| GNIS, Copernicus GLO-30 DEM, USFS EDW wilderness boundary | Analysis only | public domain / Copernicus attribution | not committed |

All requests used the User-Agent `PeaksApp-glacier-import/1.0`. The OSM
snapshot is the mirror's database date (2026-07-15), not the fetch day.

## Flags

- **Ratio (2, counted):** Conrad (OSM 0.114 km², PSU 2015 0.209 km²; 0.543)
  and Packwood (OSM 0.075 km², PSU 2015 0.031 km²; 2.416). Neither 1959 nor
  1969 reference gives dated evidence for a switch, so OSM stays.
- **No facts (0). Held (0).**
- "Of N": Gilbert Peak 2 (Conrad, Meade), Old Snowy Mountain 2 (McCall,
  Packwood); the PSU cohort's other 20 rows in the box are unnamed or "WA".

## Decision table, parents and containers

Parents are the GNIS summit nearest each glacier's DEM head; radius 1,500 m;
features checked `summit`. All four are inside Goat Rocks Wilderness (USFS
EDW boundary, 50 m margin).

| Glacier | OSM km² | GLIMS 2015 | Facts km² (year) | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| McCall Glacier | 0.783 | 0.799 | 0.799 | 0.980 | 0.574 / 0.722 | osm |
| Meade Glacier | 0.308 | 0.262 | 0.262 | 1.173 | 0.761 / 0.939 | osm |
| Conrad Glacier | 0.114 | 0.209 | 0.209 | 0.543 | 0.517 / 0.526 | osm ⚑ ratio |
| Packwood Glacier | 0.075 | 0.031 | 0.031 | 2.416 | 0.185 / 0.534 | osm ⚑ ratio |

| Glacier | Parent | DEM head (m) | Nearest GNIS summit to head | Container |
| --- | --- | ---: | --- | --- |
| Conrad Glacier | Gilbert Peak | 2328 | Goat Rocks 385 m | goat-rocks-wilderness |
| Meade Glacier | Gilbert Peak | 2383 | Gilbert Peak 84 m | goat-rocks-wilderness |
| McCall Glacier | Old Snowy Mountain | 2394 | Old Snowy Mountain 55 m | goat-rocks-wilderness |
| Packwood Glacier | Old Snowy Mountain | 2185 | Old Snowy Mountain 540 m | goat-rocks-wilderness |

| Parent key | Name | lat, lng | radius | of N |
| --- | --- | --- | ---: | ---: |
| (default) | Gilbert Peak | 46.4883, -121.4083 | 1500 | 2 |
| old-snowy-mountain | Old Snowy Mountain | 46.5121, -121.4543 | 1500 | 2 |

Parent calls: all clear except Conrad, whose head is 385 m from the GNIS
"Goat Rocks" range point and 386 m from Gilbert Peak; a range is never a
parent, so Gilbert Peak (flagged as a near tie).

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4 `_test` database; two parent fixtures and the EDW
Goat Rocks Wilderness polygon. Import of all 4, replay unchanged; a fixture
line from Gilbert Peak crosses Conrad twice (route and session); backfill
drained; verify SQL per parent: all missing-row queries empty; container
links match the manifest exactly.

## Question

Conrad and Packwood are outside the ratio band and neither is "just
outside". Keep OSM with the flag for both (Packwood is nearly melted out;
OSM draws an older, larger extent), switch either to the PSU 2015 outline
without dated evidence, or hold them? With both settled, nothing in this
package counts towards the 15% rule.

The privileged apply block is in the PR description.
