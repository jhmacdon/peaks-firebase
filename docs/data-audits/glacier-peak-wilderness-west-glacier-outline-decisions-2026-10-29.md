# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `beee6964ec2d863a8cdc2318fc7bb7a081ceeeeb10cb6a0da6acd408b4e67b12`

Output manifest: `98909698899991c90979278e538bc98a18d371b7b42439b0215b6454c239eaee`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Richardson Glacier | 0.500 | 0.684 | 0.684 | 0.731 | 1.000 | 0.693 / 0.709 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Clark Glacier | 1.323 | 1.323 | 1.323 | 1.000 | 1.000 | 0.828 / 0.906 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Pilz Glacier | 0.595 | 0.539 | 0.539 | 1.103 | 1.000 | 0.753 / 0.903 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Butterfly Glacier | 1.091 | 1.529 | 1.529 | 0.713 | 1.000 | 0.650 / 0.675 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Tenpeak Glaciers | 0.265 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Columbia Glacier | 0.661 | 0.626 | 0.626 | 1.057 | 1.000 | 0.911 / 0.980 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Pride Glacier | 0.452 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Moth Glacier | 0.521 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |

- glims-2015-09-09: 5 matched systems; 140 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1984-09-09-reference: 4 matched systems; 147 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1979-09-09-reference: 0 matched systems; 8 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1968-09-09-reference: 0 matched systems; 1 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1963-09-09-reference: 0 matched systems; 5 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1958-09-09-reference: 1 matched systems; 54 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
