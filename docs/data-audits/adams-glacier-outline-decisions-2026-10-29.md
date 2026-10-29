# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `3b84fcb52409086d1083154aebf343ee432120c7521a1bf57ec87271cdfdd21c`

Output manifest: `926ef1b7b98cd3a142d57eb1177067507e7ab1950a67238687390ae90d36696f`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Adams Glacier | 4.912 | 3.867 | 3.867 | 1.270 | 1.000 | 0.747 / 0.971 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Avalanche Glacier | 1.137 | 1.181 | 1.181 | 0.963 | 1.000 | 0.468 / 0.626 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Klickitat Glacier | 3.034 | 2.579 | 2.579 | 1.176 | 1.000 | 0.743 / 0.928 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lava Glacier | 1.568 | 1.172 | 1.172 | 1.338 | 1.000 | 0.725 / 0.983 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lyman Glacier | 2.461 | 1.441 | 1.441 | 1.708 | 1.000 | 0.543 / 0.953 | glims-2019-08-31 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Rusk Glacier | 1.174 | 1.239 | 1.239 | 0.947 | 1.000 | 0.910 / 0.928 | osm | OSM/facts ratio is within [0.67, 1.5] |
| White Salmon Glacier | 1.049 | 0.402 | 0.402 | 2.610 | 1.000 | 0.351 / 0.937 | glims-2019-08-31 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Wilson Glacier | 1.421 | 1.694 | 1.694 | 0.839 | 1.000 | 0.746 / 0.786 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Gotchen Glacier | 0.367 | 0.102 | 0.102 | 3.609 | 1.000 | 0.276 / 0.997 | glims-2019-08-31 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Crescent Glacier | 0.183 | 0.207 | 0.207 | 0.885 | 1.000 | 0.633 / 0.731 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mazama Glacier | 0.694 | 0.858 | 0.858 | 0.809 | 1.000 | 0.732 / 0.765 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Pinnacle Glacier | 1.369 | 1.060 | 1.060 | 1.292 | 1.000 | 0.540 / 0.804 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2019-08-31: 12 matched systems; 24 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1980-09-09-reference: 0 matched systems; 10 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 9 matched systems; 67 unmatched groups/features; 1 ambiguous; 1 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
