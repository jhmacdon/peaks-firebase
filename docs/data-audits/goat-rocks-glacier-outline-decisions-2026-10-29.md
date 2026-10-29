# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `3739c157474680bd3e3415c2f9b7a1e6a84e27f96ced2619a2a6492263b58dfa`

Output manifest: `3b2b6cf9e68dc9a35da172a87a25f77f1def0f74f0be4f333817c81701fcfa49`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Conrad Glacier | 0.114 | 0.209 | 0.209 | 0.543 | 1.000 | 0.517 / 0.526 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| McCall Glacier | 0.783 | 0.799 | 0.799 | 0.980 | 1.000 | 0.574 / 0.722 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Packwood Glacier | 0.075 | 0.031 | 0.031 | 2.416 | 1.000 | 0.185 / 0.534 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Meade Glacier | 0.308 | 0.262 | 0.262 | 1.173 | 1.000 | 0.761 / 0.939 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2015-09-09: 4 matched systems; 20 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 2 matched systems; 18 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1959-09-09-reference: 2 matched systems; 25 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
