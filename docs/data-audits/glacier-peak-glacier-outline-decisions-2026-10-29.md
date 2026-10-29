# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `a6276f6f47c320bf02655c88ddcc760db83b3080c42038677394b31001172118`

Output manifest: `34d7b0da90a1a93ec72088a1821f7a4401bf9290a324a33e18ca812610423ce7`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| White River Glacier | 0.763 | 0.810 | 0.810 | 0.942 | 1.000 | 0.917 / 0.929 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Chocolate Glacier | 2.210 | 2.180 | 2.180 | 1.014 | 1.000 | 0.861 / 0.931 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Kennedy Glacier | 1.382 | 1.282 | 1.282 | 1.078 | 1.000 | 0.851 / 0.956 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ptarmigan Glacier | 1.110 | 0.682 | 0.682 | 1.628 | 1.000 | 0.581 / 0.966 | glims-2015-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Sitkum Glacier | 0.702 | 0.620 | 0.620 | 1.132 | 1.000 | 0.714 / 0.888 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Suiattle Glacier | 2.307 | 2.409 | 2.409 | 0.958 | 1.000 | 0.907 / 0.931 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Vista Glacier | 1.027 | 0.759 | 0.759 | 1.353 | 1.000 | 0.721 / 0.986 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Milk Lake Glacier | 0.365 | 0.023 | 0.023 | 15.832 | 1.000 | 0.063 / 1.000 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Honeycomb Glacier | 2.874 | 2.901 | 2.901 | 0.991 | 1.000 | 0.916 / 0.952 | osm | OSM/facts ratio is within [0.67, 1.5] |
| White Chuck Glacier | 0.908 | 0.987 | 0.987 | 0.920 | 1.000 | 0.792 / 0.849 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Cool Glacier | 1.243 | 1.362 | 1.362 | 0.912 | 1.000 | 0.846 / 0.876 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Scimitar Glacier | 0.755 | 0.671 | 0.671 | 1.125 | 1.000 | 0.754 / 0.914 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Dusty Glacier | 1.371 | 1.196 | 1.196 | 1.147 | 1.000 | 0.829 / 0.973 | osm | OSM/facts ratio is within [0.67, 1.5] |
| North Guardian Glacier | 0.790 | 0.835 | 0.835 | 0.946 | 1.000 | 0.835 / 0.886 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ermine Glacier | 1.191 | 1.229 | 1.229 | 0.969 | 1.000 | 0.880 / 0.921 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Gerdine Glacier | 1.760 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |

- glims-2015-09-09: 15 matched systems; 45 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1984-09-09-reference: 15 matched systems; 66 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
