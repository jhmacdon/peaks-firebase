# Olympic Mountains glaciers — review packet, 2026-10-29

**12 glaciers. Counted flags 2 of 14 (14%): Cameron (ratio, kept by
review) and White (invalid outline, held).** Outline rule 2 (#290).
Offline work only. Spec: `cloud-sql/migrate/src/import-olympics-glaciers.ts`.
Decisions: [Markdown](olympics-glacier-outline-decisions-2026-10-29.md),
[JSON](olympics-glacier-outline-decisions-2026-10-29.json).

Reviewed manifest SHA-256 (platform-stable):
`b758ee9d3586c2d2ecdcb5974caa084256f69bc298966809d774be2755f31519`.

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

## Roster: 12 places; 2 OSM polygons held back

**Label correction (#288):** OSM's "Fairchild Glacier" (relation:13754230)
holds the GNIS Carrie Glacier point (1531450, 47.89103,-123.63640) and 79–80%
of each PSU 2015 "Carrie Glacier" row, so it is imported as **Carrie
Glacier** (parent Mount Carrie: DEM head 2,069 m, 207 m from the summit;
OSM/facts 0.990). Provenance records "label corrected from OSM name
Fairchild Glacier"; OpenStreetMap is not edited.

| OSM element | OSM name | Why held back |
| --- | --- | --- |
| relation:18773387 | White Glacier | Invalid geometry: inner way 1364013531 shares two edge segments with the outer way. Not repaired or redrawn. |
| way:1027283192 | Carrie Glacier | Unidentified: it is the PSU "Carrie Glacier WA" feature, 1.0 km NW of GNIS Carrie; the GNIS Fairchild Glacier point (1529151, 47.90657,-123.62897, NE side of Mount Fairchild) lies in no OSM polygon, so it is not Fairchild either. |

Fairchild Glacier is not imported: no OSM polygon contains its GNIS point.

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
| Queets | 0.446 | 0.293 | 0.293 | 1.525 | 0.636 / 0.982 | **GLIMS 2015** (rule 2: OSM undated) |
| Cameron Glaciers | 0.340 | 0.193 | 0.193 | 1.764 | 0.529 / 0.956 | osm ⚑ ratio, kept by review |
| Anderson | 0.130 | 0.013 | 0.013 | 10.165 | 0.087 / 0.898 | **GLIMS 2015** (rule 2; the glacier has nearly melted out) |
| Hanging | 0.076 | 0.061 | 0.061 | 1.257 | 0.743 / 0.962 | osm |
| Carrie (OSM "Fairchild") | 0.494 | 0.499 | 0.499 | 0.990 | — | osm |

Blue's facts area (5.111, two parts) differs from its dissolved candidate
(5.137) because the cohort's parts overlap slightly.

## Parent mountain (Copernicus DEM head + GNIS summits)

| Glacier | DEM head (m) | Nearest summit to head | Proposed parent | Call |
| --- | ---: | --- | --- | --- |
| Blue | 2,377 | Mount Olympus 67 m | Mount Olympus | clear |
| Hoh | 2,355 | Middle Peak (Olympus) 20 m | Mount Olympus | clear (Olympus sub-summit) |
| Hubert | 2,124 | East Peak (Olympus) 1.7 km | Mount Olympus | clear |
| Jeffers | 1,817 | East Peak (Olympus) 2.5 km | Mount Olympus | clear |
| Humes | 1,905 | Mount Mathias 2.3 km | Mount Olympus | checked (heads on Olympus' east ridge) |
| Ice River | 1,953 | Mount Mathias 1.9 km | Mount Olympus | checked (north side) |
| Queets | 1,932 | Mount Queets 107 m | Mount Queets | checked |
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
| Mount Carrie | 47.8942, -123.6491 | summit | 1500 m |

"Of N": Mount Olympus 6 (Blue, Hoh, Hubert, Humes, Ice River, Jeffers),
Mount Anderson 3, Mount Queets 1, Mount Cameron 1, Mount Carrie 1 (Carrie).
White Glacier heads on Mount Tom (159 m from its head) and is held, so Mount
Tom is not a parent here.

## Containing area

All 11 → **Olympic National Park** (`national_park`); NPS boundary (Land
Resources Division service, analysis only), smallest margin 8 km.

## Flags (2026-10-29: ratio and outline quality count; 2 of 14, 14%)

- **Ratio (1, counted):** Cameron Glaciers (1.764); OSM kept by the
  reviewed decision, flagged.
- **Outline quality (1, counted, held):** White (invalid OSM geometry; the
  hole-contact rule of #285 still rejects it).
- **Held, identity (1):** way:1027283192 (OSM "Carrie"), unidentified.
- **No facts (0).**
- **Switched to the PSU 2015 outline:** Ice River and Jeffers (1987 reference
  shows OSM older); Queets and Anderson (rule 2: OSM extents are undated, the
  inventory is dated and closer to the facts area).
- **Parents:** all checked by the reviewed research; none unclear.

## Disposable-DB check

Re-run for the rule-2 manifest: import of 12, replay unchanged, backfill
drained, verify SQL per parent (5) clean, container links match.

Earlier run: PG 15.19 / PostGIS 3.6.4; fixtures for the four parents and the NPS park
polygon. Import, replay unchanged; a line from the Hoh valley to the summit
crosses Hoh (886 m) and Blue (three passes) in route and session; backfill
drained; `glacier-region-verify.sql` run per parent: all missing-row queries
empty; credits OSM 9 (2026-07-15) and PSU 2 (2015-09-09).

## Outline overlaps (neighbour check, #290)

After sources were chosen, every pair of final outlines in each package was
measured. No pair overlaps by more than 1% of the smaller outline or 0.01 km²,
so no group was moved to one source and nothing was clipped. Resolution:
none needed. The decision reports' "Outline overlaps" section records the
same result.
