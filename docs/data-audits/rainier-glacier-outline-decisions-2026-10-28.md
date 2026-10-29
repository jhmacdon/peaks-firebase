# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `6b23ec7ada58eb909e2e85652ef73f511a223b460029411ccd6cf478fb8d0ac7`

Output manifest: `7db50df9c523308c511feb4465fa1ae1567be9c291cadc492397e591bdaa446e`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Pyramid Glaciers | 1.130 | 0.295 | 0.176 | 6.418 | 1.678 | 0.260 / 0.995 | glims-2019-09-09 ⚑ | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1; selected ratio still outside band |
| South Tahoma Glacier | 2.102 | 1.974 | 1.947 | 1.080 | 1.014 | 0.877 / 0.965 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Success Glacier | 0.610 | 0.773 | 0.396 | 1.539 | 1.950 | 0.534 / 0.623 | osm ⚑ | OSM ratio outside band; no licence-OK, newer candidate has a ratio closer to 1 |
| Van Trump Glacier | 0.738 | 0.324 | 0.117 | 6.319 | 2.774 | 0.352 / 0.853 | glims-2019-09-09 ⚑ | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1; selected ratio still outside band |
| Puyallup Glacier | 3.609 | 3.362 | 3.098 | 1.165 | 1.085 | 0.887 / 0.974 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ohanapecosh Glacier | 1.172 | 0.802 | 0.616 | 1.903 | 1.303 | 0.457 / 0.771 | glims-2019-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Pinnacle Glacier | 0.002 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Sarvant Glacier | 0.227 | 0.325 | 0.380 | 0.596 | 0.855 | 0.609 / 0.642 | glims-2019-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Flett Glacier | 0.430 | 0.452 | 0.363 | 1.186 | 1.244 | 0.903 / 0.927 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Paradise Glacier | 1.002 | 0.454 | 0.581 | 1.726 | 0.782 | 0.404 / 0.923 | glims-2019-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Ingraham Glacier | 3.588 | 3.462 | 2.962 | 1.211 | 1.169 | 0.895 / 0.962 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Muir Snowfield | 1.206 | 0.774 | — | — | — | 0.632 / 0.991 | osm ⚑ | No individual facts area; retain OSM for review |
| Nisqually Glacier | 3.681 | 4.489 | 4.102 | 0.897 | 1.094 | 0.789 / 0.803 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Cowlitz Glacier | 3.022 | 3.402 | 3.685 | 0.820 | 0.923 | 0.749 / 0.809 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Whitman Glacier | 2.193 | 2.081 | 1.846 | 1.188 | 1.128 | 0.831 / 0.932 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Emmons Glacier | 10.919 | 11.245 | 10.959 | 0.996 | 1.026 | 0.929 / 0.949 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Fryingpan Glacier | 3.483 | 3.243 | 2.993 | 1.164 | 1.083 | 0.869 / 0.964 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Carbon Glacier | 6.639 | 7.359 | 7.127 | 0.931 | 1.033 | 0.874 / 0.887 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Winthrop Glacier | 8.306 | 8.507 | 8.688 | 0.956 | 0.979 | 0.886 / 0.929 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Inter Glacier | 0.574 | 0.596 | 0.532 | 1.078 | 1.120 | 0.889 / 0.924 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Kautz Glacier | 1.786 | 1.289 | 1.561 | 1.144 | 0.826 | 0.665 / 0.953 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Wilson Glacier | 1.567 | 1.424 | 1.459 | 1.073 | 0.976 | 0.746 / 0.897 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Tahoma Glacier | 6.578 | 7.024 | 6.433 | 1.023 | 1.092 | 0.833 / 0.880 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Columbia Crest Glacier | 0.176 | — | 0.172 | 1.024 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Liberty Cap Glacier | 2.033 | 1.099 | 2.076 | 0.979 | 0.530 | 0.533 / 0.991 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Edmunds Glacier | 1.364 | 1.209 | 1.165 | 1.171 | 1.038 | 0.842 / 0.973 | osm | OSM/facts ratio is within [0.67, 1.5] |
| South Mowich Glacier | 3.856 | 3.998 | 3.626 | 1.063 | 1.102 | 0.728 / 0.827 | osm | OSM/facts ratio is within [0.67, 1.5] |
| North Mowich Glacier | 5.224 | 5.105 | 4.907 | 1.065 | 1.040 | 0.923 / 0.971 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Russell Glacier | 2.836 | 2.683 | 2.706 | 1.048 | 0.992 | 0.917 / 0.984 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2019-09-09: 27 matched systems; 55 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1970-09-09-reference: 27 matched systems; 138 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
