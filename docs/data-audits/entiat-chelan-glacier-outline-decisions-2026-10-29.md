# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `9251462803afeb69c4e5b9cb100a84bbcbdc43fdfdcfeb12eaee5032eeab340a`

Output manifest: `5d3c95cd14ce615ca56f955ae92fbb5814a98767af0292008d1c693d51804a13`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Entiat Glacier | 0.430 | 0.453 | 0.453 | 0.949 | 1.000 | 0.790 / 0.860 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Hanging Glacier | 0.063 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Company Glacier | 0.908 | 0.988 | 0.988 | 0.919 | 1.000 | 0.796 / 0.851 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mary Green Glacier | 0.662 | 0.647 | 0.647 | 1.023 | 1.000 | 0.945 / 0.983 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Isella Glacier | 0.312 | 0.325 | 0.325 | 0.960 | 1.000 | 0.940 / 0.950 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Grant Glacier | 0.149 | 0.154 | 0.154 | 0.964 | 1.000 | 0.946 / 0.955 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lyman Glacier | 0.209 | 0.214 | 0.214 | 0.979 | 1.000 | 0.970 / 0.975 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Spider Glacier | 0.050 | 0.050 | 0.050 | 0.989 | 1.000 | 0.957 / 0.973 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Dark Glacier | 0.503 | 0.504 | 0.504 | 0.999 | 1.000 | 0.894 / 0.944 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2017-09-09: 8 matched systems; 87 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1984-09-09-reference: 7 matched systems; 144 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1979-09-09-reference: 0 matched systems; 8 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1968-09-09-reference: 0 matched systems; 1 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1963-09-09-reference: 0 matched systems; 5 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1958-09-09-reference: 1 matched systems; 54 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
