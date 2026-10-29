# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `3739c157474680bd3e3415c2f9b7a1e6a84e27f96ced2619a2a6492263b58dfa`

Output manifest: `64f399ee9c1290ae1b55cfdcdef0270823ffc9672a3466a5878aa5f3eb89b6f4`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Conrad Glacier | 0.114 | 0.209 | 0.209 | 0.543 | 1.000 | 0.517 / 0.526 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| McCall Glacier | 0.783 | 0.799 | 0.799 | 0.980 | 1.000 | 0.574 / 0.722 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Packwood Glacier | 0.075 | 0.031 | 0.031 | 2.416 | 1.000 | 0.185 / 0.534 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Meade Glacier | 0.308 | 0.262 | 0.262 | 1.173 | 1.000 | 0.761 / 0.939 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2015-09-09: 4 matched systems; 20 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 2 matched systems; 18 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1959-09-09-reference: 2 matched systems; 25 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
