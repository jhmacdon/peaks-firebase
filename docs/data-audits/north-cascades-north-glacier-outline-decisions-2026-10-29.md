# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `40bc4573fd1dcb3329691d0db098cc5101484adb28dd8734d5c70429f092b2a8`

Output manifest: `fae62d072007f11fe4b6699094afaa34fba666185b256e8651b0eb368fc36a77`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Nohokomeen Glacier | 1.588 | 1.477 | 1.477 | 1.075 | 1.000 | 0.841 / 0.948 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Redoubt Glacier | 2.181 | 2.165 | 2.165 | 1.008 | 1.000 | 0.938 / 0.972 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Table Mountain Glacier | 0.033 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Challenger Glacier | 4.187 | 3.592 | 3.592 | 1.166 | 1.000 | 0.826 / 0.980 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Terror Glacier | 0.519 | 0.477 | 0.477 | 1.088 | 1.000 | 0.823 / 0.943 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Whatcom Glacier | 0.250 | 0.145 | 0.145 | 1.720 | 1.000 | 0.564 / 0.981 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Sisters Glacier | 0.873 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| West Nooksack Glacier | 0.104 | 0.019 | 0.019 | 5.512 | 1.000 | 0.166 / 0.929 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Ruth Glacier | 0.211 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Diobsud Glacier | 1.108 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Sulphide Glacier | 3.439 | 3.145 | 3.145 | 1.094 | 1.000 | 0.893 / 0.988 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Colonial Glacier | 0.560 | 0.560 | 0.560 | 1.000 | 1.000 | 0.796 / 0.887 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lower Curtis Glacier | 0.466 | 0.425 | 0.425 | 1.096 | 1.000 | 0.877 / 0.979 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Hanging Glacier | 0.450 | 0.408 | 0.408 | 1.103 | 1.000 | 0.731 / 0.888 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Upper Curtis Glacier | 0.384 | 0.395 | 0.395 | 0.972 | 1.000 | 0.785 / 0.867 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Price Glacier | 0.862 | 1.130 | 1.130 | 0.763 | 1.000 | 0.519 / 0.602 | osm | OSM/facts ratio is within [0.67, 1.5] |
| East Nooksack Glacier | 1.883 | 1.613 | 1.613 | 1.167 | 1.000 | 0.639 / 0.845 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Crystal Glacier | 2.275 | 2.144 | 2.144 | 1.061 | 1.000 | 0.922 / 0.988 | osm | OSM/facts ratio is within [0.67, 1.5] |
| White Salmon Glacier | 0.399 | 0.334 | 0.334 | 1.192 | 1.000 | 0.802 / 0.976 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Spillway Glacier | 0.056 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Jerry Glacier | 0.144 | 0.188 | 0.188 | 0.763 | 1.000 | 0.718 / 0.737 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Silver Glacier | 0.411 | 0.329 | 0.329 | 1.249 | 1.000 | 0.767 / 0.976 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lower Price Glacier | 0.444 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |

- glims-2015-09-09: 17 matched systems; 345 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1985-09-09-reference: 0 matched systems; 32 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1983-09-09-reference: 4 matched systems; 161 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1975-09-09-reference: 0 matched systems; 43 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1974-09-09-reference: 10 matched systems; 246 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1968-09-09-reference: 2 matched systems; 92 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1959-09-09-reference: 1 matched systems; 6 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1958-09-09-reference: 1 matched systems; 18 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
