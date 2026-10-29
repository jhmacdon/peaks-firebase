# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `0f4ea3f5fed43b9f040623358016b377a78ce4f3238fa2f82e847819502e1209`

Output manifest: `fdf14e82b155fed3eac939c7535e093217ce8449b3ad0aaed2aa865b9d384771`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Adams Glacier | 4.912 | 3.867 | 3.867 | 1.270 | 1.000 | 0.747 / 0.971 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Klickitat Glacier | 3.034 | 2.579 | 2.579 | 1.176 | 1.000 | 0.743 / 0.928 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lava Glacier | 1.568 | 1.172 | 1.172 | 1.338 | 1.000 | 0.725 / 0.983 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lyman Glacier | 2.461 | 1.441 | 1.441 | 1.708 | 1.000 | 0.543 / 0.953 | glims-2019-08-31 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Rusk Glacier | 1.174 | 1.239 | 1.239 | 0.947 | 1.000 | 0.910 / 0.928 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Wilson Glacier | 1.421 | 1.694 | 1.694 | 0.839 | 1.000 | 0.746 / 0.786 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Gotchen Glacier | 0.367 | 0.102 | 0.102 | 3.609 | 1.000 | 0.276 / 0.997 | glims-2019-08-31 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Crescent Glacier | 0.183 | 0.207 | 0.207 | 0.885 | 1.000 | 0.633 / 0.731 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mazama Glacier | 0.694 | 0.858 | 0.858 | 0.809 | 1.000 | 0.732 / 0.765 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Pinnacle Glacier | 1.369 | 1.060 | 1.060 | 1.292 | 1.000 | 0.540 / 0.804 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2019-08-31: 10 matched systems; 26 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1980-09-09-reference: 0 matched systems; 10 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1969-09-09-reference: 10 matched systems; 68 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
