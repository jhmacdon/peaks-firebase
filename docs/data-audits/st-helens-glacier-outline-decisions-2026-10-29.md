# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `74d99318311596f0babcbd2656492d52e4082cd206b623d5d89f940dd5852119`

Output manifest: `aabf0e83cdbc80bcc3e260473aa4beb58e56b01eff43fd3ac40281d1f7627f34`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Crater Glacier | 1.682 | 1.740 | 1.740 | 0.967 | 1.000 | 0.874 / 0.917 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2019-09-09: 1 matched systems; 1 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1980-09-09-reference: 0 matched systems; 10 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 0 matched systems; 77 unmatched groups/features; 0 ambiguous; 1 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
