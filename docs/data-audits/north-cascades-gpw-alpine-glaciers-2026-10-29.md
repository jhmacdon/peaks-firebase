# North Cascades (Glacier Peak Wilderness edges, Entiat/Chelan, Alpine Lakes) — review packet, 2026-10-29

**27 glaciers in three packages. Flags: 0 ratio, 7 no facts, 0 held.**
Outline rule 2 (#290): Lynch takes the dated PSU 2015 outline; the other two
packages' hashes change only because the review records rule 2.
Three packages, one apply each, because their PSU cohorts differ:

| Package | Spec | Places | Cohort | Reviewed manifest SHA-256 |
| --- | --- | ---: | --- | --- |
| Glacier Peak Wilderness west (Dakobed, Monte Cristo) | `import-glacier-peak-wilderness-west-glaciers.ts` | 8 | 2015-09-09 | `9778343d582e9d8ef2367704d8fad61be172b99dc1f76f783d2fdfef719ddad2` |
| Entiat and Chelan Mountains | `import-entiat-chelan-glaciers.ts` | 9 | 2017-09-09 | `bc317b8300376b81c05699c5b9dc9154b51fb7fda78f078bad9f85a285f806a8` |
| Alpine Lakes and Stuart Range | `import-alpine-lakes-glaciers.ts` | 10 | 2015-09-09 | `7077914899279f0c8fa1129b42ffb2b3d088f2df296a9737e3c3793564e34ebc` |

The first two read byte-identical copies of one snapshot set (box
47.90,-121.60,48.30,-120.50, OSM base 2026-07-28T02:16:18Z); in that box the
PSU inventory dates the Dakobed/Monte Cristo glaciers 2015-09-09 and the
Entiat/Chelan glaciers 2017-09-09, with no glacier in both. Alpine Lakes uses
box 47.30,-121.60,47.90,-120.60 (OSM base 2026-07-24T11:04:51Z). Mirrors:
`overpass.private.coffee` and `overpass.kumi.systems`.

Left out of the first box: Glacier Peak's 16 (#276) and Chickamin
(north-cascades-south). GNIS lists no named glacier missing from OSM in
either box. PSU-only names: **Ice Worm Glacier** counts at Mount Daniel;
David Glacier (2017 cohort) lies near Mount David, not a parent here, and is
only listed; landmark-named patches (Columbia Peak, Kyes Peak, Vesper, Lemah,
Diptop, East Daniels, Stuart West, West Lynch) and "… WA" names are not
counted.

## Apply-time parent check (2026-10-29)

The production lookup found 18 of 20 parents by exact name. Two changed, so
two hashes changed (Alpine Lakes is unchanged):

| Package | Was | Now | Why |
| --- | --- | --- | --- |
| GPW west | Tenpeak Mountain | Ten Peak Mountain | Peaks name (6 m) |
| Entiat–Chelan | Red Mountain (Spider Glacier) | Phelps Ridge | no Red Mountain in Peaks; nearest Peaks summit, 556 m from the centroid |

## Sources and licences

| Source | Licence | SHA-256 |
| --- | --- | --- |
| OSM via Overpass mirrors (GPW box / Alpine box) | ODbL-1.0 | `5a80174e…3a3d` / `68783a57…9c74` |
| Fountain, Glenn & McNeil (2023), GLIMS WFS | CC0-1.0 | `85ce8a2c…2bfc` / `ffaa087a…79c6` |
| RGI 7.0 via GLIMS WFS | CC BY 4.0 | `6bb77ea5…bc6f` / `b44e64e1…f430` |
| GNIS, Copernicus GLO-30 DEM, USFS EDW wilderness boundaries | analysis only | not committed |

## Flags

- **Ratio (0).** Lynch (1.547) takes the PSU 2015 outline under outline
  rule 2 (OSM extents are undated; the inventory is dated and closer).
- **No facts (7, not counted):** no named row in any cleared PSU cohort;
  imported with null facts: Tenpeak, Moth, Pride (west); Hanging (Entiat);
  Overcoat, Chimney, Foss (Alpine Lakes).
- **Held (0).**
- Switched to the 2015 inventory outline (1957 reference fits OSM better):
  Colchuck, Snow Creek (not flagged).

Parent corrections from the reviewed research (2026-10-29): **Pilz** and
**Butterfly → Luahna Peak** (Wikipedia: north slopes of Luahna Peak; northwest
slopes of its NW summit; DEM heads 79 m and 869 m from the OSM summit node),
**Moth → Neyah Point**, flagged "parent inferred" (climbing reports only; DEM
head 84 m from the OSM node). Luahna Peak and Neyah Point are not in GNIS:
their points are OSM nodes 8826387283 (48.06063,-120.98489, 2,560 m) and
8826387492 (48.07788,-121.02369, 2,464 m), base 2026-07-15. The Peaks
catalog must hold both summits for the apply step.

Parent calls checked by the reviewed research, all agreed (none unclear): Richardson (Clark
Mountain; its head is 769 m from Luahna Peak and 979 m from Clark), Columbia
(Wilmans Peaks is nearer but lower), Isella (Bonanza 866 m), Lyman and
Hanging (Chiwawa Mountain 0.8–1.7 km), Spider (Red Mountain 1.6 km),
Overcoat (head next to Chimney Rock; named after Overcoat Peak 586 m away).

## Glacier Peak Wilderness west

| Glacier | OSM km² | GLIMS 2015 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Butterfly Glacier | 1.091 | 1.529 | 1.529 | 0.713 | 0.650 / 0.675 | osm |
| Clark Glacier | 1.323 | 1.323 | 1.323 | 1.000 | 0.828 / 0.906 | osm |
| Richardson Glacier | 0.500 | 0.684 | 0.684 | 0.731 | 0.693 / 0.709 | osm |
| Columbia Glacier | 0.661 | 0.626 | 0.626 | 1.057 | 0.911 / 0.980 | osm |
| Pilz Glacier | 0.595 | 0.539 | 0.539 | 1.103 | 0.753 / 0.903 | osm |
| Tenpeak Glaciers | 0.265 | — | — | — | — / — | osm ⚑ no facts |
| Pride Glacier | 0.452 | — | — | — | — / — | osm ⚑ no facts |
| Moth Glacier | 0.521 | — | — | — | — / — | osm ⚑ no facts |

| Glacier | Parent | DEM head (m) | Nearest GNIS summit to head | Container |
| --- | --- | ---: | --- | --- |
| Butterfly Glacier | Luahna Peak | 2495 | Luahna Peak 869 m (OSM node) | glacier-peak-wilderness |
| Clark Glacier | Clark Mountain | 2522 | Clark Mountain 84 m | glacier-peak-wilderness |
| Pilz Glacier | Luahna Peak | 2500 | Luahna Peak 79 m (OSM node) | glacier-peak-wilderness |
| Richardson Glacier | Clark Mountain | 2388 | Clark Mountain 982 m | glacier-peak-wilderness |
| Columbia Glacier | Columbia Peak | 1719 | Wilmans Peaks 691 m | henry-m-jackson-wilderness |
| Pride Glacier | Kyes Peak | 1936 | Kyes Peak 269 m | henry-m-jackson-wilderness |
| Moth Glacier | Neyah Point ⚑ parent inferred | 2476 | Neyah Point 84 m (OSM node) | glacier-peak-wilderness |
| Tenpeak Glaciers | Tenpeak Mountain | 2453 | Tenpeak Mountain 51 m | glacier-peak-wilderness |

| Parent key | Name | lat, lng | radius | of N |
| --- | --- | --- | ---: | ---: |
| (default) | Clark Mountain | 48.0501, -120.9685 | 1500 | 2 |
| luahna-peak | Luahna Peak | 48.0606, -120.9849 (OSM) | 1500 | 2 |
| neyah-point | Neyah Point | 48.0779, -121.0237 (OSM) | 1500 | — |
| tenpeak-mountain | Tenpeak Mountain | 48.0772, -121.0343 | 1500 | — |
| kyes-peak | Kyes Peak | 47.9647, -121.3337 | 1500 | — |
| columbia-peak | Columbia Peak | 47.9616, -121.3614 | 1500 | 1 |

## Entiat and Chelan Mountains

| Glacier | OSM km² | GLIMS 2015 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Company Glacier | 0.908 | 0.988 | 0.988 | 0.919 | 0.796 / 0.851 | osm |
| Mary Green Glacier | 0.662 | 0.647 | 0.647 | 1.023 | 0.945 / 0.983 | osm |
| Dark Glacier | 0.503 | 0.504 | 0.504 | 0.999 | 0.894 / 0.944 | osm |
| Entiat Glacier | 0.430 | 0.453 | 0.453 | 0.949 | 0.790 / 0.860 | osm |
| Isella Glacier | 0.312 | 0.325 | 0.325 | 0.960 | 0.940 / 0.950 | osm |
| Lyman Glacier | 0.209 | 0.214 | 0.214 | 0.979 | 0.970 / 0.975 | osm |
| Grant Glacier | 0.149 | 0.154 | 0.154 | 0.964 | 0.946 / 0.955 | osm |
| Spider Glacier | 0.050 | 0.050 | 0.050 | 0.989 | 0.957 / 0.973 | osm |
| Hanging Glacier | 0.063 | — | — | — | — / — | osm ⚑ no facts |

| Glacier | Parent | DEM head (m) | Nearest GNIS summit to head | Container |
| --- | --- | ---: | --- | --- |
| Company Glacier | Bonanza Peak | 2687 | Bonanza Peak 160 m | glacier-peak-wilderness |
| Isella Glacier | Bonanza Peak | 2713 | Bonanza Peak 866 m | glacier-peak-wilderness |
| Mary Green Glacier | Bonanza Peak | 2708 | Bonanza Peak 138 m | glacier-peak-wilderness |
| Hanging Glacier | Chiwawa Mountain | 2285 | Chiwawa Mountain 1691 m | glacier-peak-wilderness |
| Lyman Glacier | Chiwawa Mountain | 2075 | Chiwawa Mountain 817 m | glacier-peak-wilderness |
| Dark Glacier | Dark Peak | 2510 | Dark Peak 253 m | glacier-peak-wilderness |
| Entiat Glacier | Mount Maude | 2509 | Mount Maude 371 m | glacier-peak-wilderness |
| Grant Glacier | North Star Mountain | 2350 | North Star Mountain 89 m | glacier-peak-wilderness |
| Spider Glacier | Red Mountain | 2165 | Phelps Ridge 1574 m | glacier-peak-wilderness |

| Parent key | Name | lat, lng | radius | of N |
| --- | --- | --- | ---: | ---: |
| (default) | Bonanza Peak | 48.2382, -120.8663 | 1500 | 3 |
| north-star-mountain | North Star Mountain | 48.2228, -120.9006 | 1500 | 1 |
| dark-peak | Dark Peak | 48.2546, -120.8818 | 1500 | 1 |
| mount-maude | Mount Maude | 48.1376, -120.8037 | 1500 | 1 |
| chiwawa-mountain | Chiwawa Mountain | 48.1634, -120.9075 | 1500 | 1 |
| red-mountain | Red Mountain | 48.1542, -120.8817 | 1500 | 1 |

## Alpine Lakes and Stuart Range

| Glacier | OSM km² | GLIMS 2015 | Facts | OSM/facts | IoU / share | Chosen |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Lynch Glacier | 0.742 | 0.480 | 0.480 | 1.547 | 0.580 / 0.935 | **GLIMS 2015** (rule 2) |
| Hinman Glacier | 0.207 | 0.278 | 0.278 | 0.746 | 0.686 / 0.711 | osm |
| Stuart Glacier | 0.102 | 0.113 | 0.113 | 0.902 | 0.887 / 0.894 | osm |
| Colchuck Glacier | 0.200 | 0.112 | 0.112 | 1.788 | 0.531 / 0.967 | **GLIMS 2015-09-09** |
| Ice Cliff Glacier | 0.063 | 0.067 | 0.067 | 0.941 | 0.890 / 0.914 | osm |
| Sherpa Glacier | 0.071 | 0.061 | 0.061 | 1.179 | 0.751 / 0.935 | osm |
| Snow Creek Glacier | 0.136 | 0.036 | 0.036 | 3.779 | 0.248 / 0.949 | **GLIMS 2015-09-09** |
| Overcoat Glacier | 0.456 | — | — | — | — / — | osm ⚑ no facts |
| Chimney Glacier | 0.318 | — | — | — | — / — | osm ⚑ no facts |
| Foss Glacier | 0.329 | — | — | — | — / — | osm ⚑ no facts |

| Glacier | Parent | DEM head (m) | Nearest GNIS summit to head | Container |
| --- | --- | ---: | --- | --- |
| Ice Cliff Glacier | Mount Stuart | 2537 | Mount Stuart 484 m | alpine-lakes-wilderness |
| Stuart Glacier | Mount Stuart | 2445 | Mount Stuart 342 m | alpine-lakes-wilderness |
| Chimney Glacier | Chimney Rock | 2065 | Chimney Rock 304 m | alpine-lakes-wilderness |
| Colchuck Glacier | Colchuck Peak | 2467 | Colchuck Peak 472 m | alpine-lakes-wilderness |
| Snow Creek Glacier | Little Annapurna | 2549 | Little Annapurna 159 m | alpine-lakes-wilderness |
| Lynch Glacier | Mount Daniel | 2398 | Mount Daniel 531 m | alpine-lakes-wilderness |
| Foss Glacier | Mount Hinman | 2275 | Mount Hinman 36 m | alpine-lakes-wilderness |
| Hinman Glacier | Mount Hinman | 2193 | Mount Hinman 431 m | alpine-lakes-wilderness |
| Overcoat Glacier | Overcoat Peak | 2198 | Chimney Rock 165 m | alpine-lakes-wilderness |
| Sherpa Glacier | Sherpa Peak | 2436 | Sherpa Peak 187 m | alpine-lakes-wilderness |

| Parent key | Name | lat, lng | radius | of N |
| --- | --- | --- | ---: | ---: |
| (default) | Mount Stuart | 47.475, -120.9022 | 1500 | 2 |
| sherpa-peak | Sherpa Peak | 47.4717, -120.8886 | 1500 | 1 |
| colchuck-peak | Colchuck Peak | 47.4782, -120.8464 | 1500 | 1 |
| little-annapurna | Little Annapurna | 47.4683, -120.8143 | 1500 | 1 |
| mount-hinman | Mount Hinman | 47.5688, -121.2146 | 1500 | 1 |
| mount-daniel | Mount Daniel | 47.5626, -121.1719 | 1500 | 2 |
| chimney-rock | Chimney Rock | 47.509, -121.2858 | 1500 | — |
| overcoat-peak | Overcoat Peak | 47.5138, -121.2921 | 1500 | — |

## Disposable-DB check

PG 15.19 / PostGIS 3.6.4, one database per package with its parent fixtures
and the real EDW wilderness polygons. Each: import, replay unchanged,
backfill drained, verify SQL per parent with all missing-row queries empty,
container links equal to the manifest. Fixture lines cross Clark Glacier
(twice) and Stuart Glacier; the Entiat line missed the ice (no crossing to
check there).

## Decisions applied (2026-10-29)

1. Glaciers without a cohort row are imported with null facts, flagged
   "no facts", not counted. No other cleared PSU cohort names them.
2. One cohort per package (2015 west and Alpine Lakes, 2017 Entiat–Chelan)
   stays; each glacier has one cohort.
3. Lynch takes the PSU 2015 outline (outline rule 2).
4. Parents: Pilz and Butterfly → Luahna Peak, Moth → Neyah Point (parent
   inferred); every other flagged call checked by the reviewed research and
   kept.

## Outline overlaps (neighbour check, #290)

After sources were chosen, every pair of final outlines in each package was
measured. No pair overlaps by more than 1% of the smaller outline or 0.01 km²,
so no group was moved to one source and nothing was clipped. Resolution:
none needed. The decision reports' "Outline overlaps" section records the
same result.
