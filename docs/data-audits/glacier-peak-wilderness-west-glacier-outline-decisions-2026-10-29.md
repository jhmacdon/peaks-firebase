# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `dbf0b7809f8639cf6e1a6742ca0ae0a87fc24b0c43d283d442bfaa5558157283`

Output manifest: `a4135b2ff33fe896bf9402b6e2d2db33443ab422fa2c70bb386d1e628c8ede60`

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
