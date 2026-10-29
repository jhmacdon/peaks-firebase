# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `ed6c3241d40c015a75d2a3829206e36c5e0977eb14b54f6e77af13f43e86863e`

Output manifest: `d159232353a890bdc50c4c589566c7b327ceab619982f35b86e1b8a1224eb642`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Crater Glacier | 1.682 | 1.740 | 1.740 | 0.967 | 1.000 | 0.874 / 0.917 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2019-09-09: 1 matched systems; 1 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1980-09-09-reference: 0 matched systems; 10 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 0 matched systems; 78 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
