# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `3be5a8502c6a0a424f72283e5b5d36d430a0d03b2c27c11ef5510baf8d62db08`

Output manifest: `c082ef875e6d6bf8e3173183bf62c3c791a873bb87de0f3771ee596393694c13`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Park Glacier | 4.812 | 3.196 | 3.196 | 1.506 | 1.000 | 0.546 / 0.885 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Boulder Glacier | 2.874 | 3.381 | 3.381 | 0.850 | 1.000 | 0.836 / 0.842 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Deming Glacier | 3.851 | 4.382 | 4.382 | 0.879 | 1.000 | 0.851 / 0.864 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Roosevelt Glacier | 3.340 | 3.700 | 3.700 | 0.903 | 1.000 | 0.875 / 0.888 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Coleman Glacier | 5.732 | 6.056 | 6.056 | 0.946 | 1.000 | 0.871 / 0.906 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Easton Glacier | 2.778 | 3.015 | 3.015 | 0.921 | 1.000 | 0.842 / 0.878 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Talum Glaciers | 1.177 | 1.888 | 1.888 | 0.623 | 1.000 | 0.595 / 0.605 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Squak Glacier | 2.264 | 1.920 | 1.921 | 1.179 | 1.000 | 0.716 / 0.909 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mazama Glacier | 3.834 | 4.424 | 4.423 | 0.867 | 1.000 | 0.782 / 0.819 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Rainbow Glacier | 1.676 | 2.004 | 2.004 | 0.836 | 1.000 | 0.757 / 0.791 | osm | OSM/facts ratio is within [0.67, 1.5] |
| No Name Glacier | 0.272 | — | 0.375 | 0.726 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Thunder Glacier | 0.840 | 0.795 | 0.795 | 1.057 | 1.000 | 0.846 / 0.942 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Hadley Glacier | 0.672 | 0.663 | 0.663 | 1.014 | 1.000 | 0.824 / 0.910 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Sholes Glacier | 1.108 | 1.015 | 1.015 | 1.092 | 1.000 | 0.608 / 0.791 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2015-09-09: 13 matched systems; 45 unmatched groups/features; 0 ambiguous; 1 invalid. Full identities and reasons are in JSON.
- glims-1975-09-09-reference: 13 matched systems; 30 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1974-09-09-reference: 1 matched systems; 43 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
