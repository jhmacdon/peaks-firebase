# Glacier outline decisions

Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `0da78122e4f3b53fb1cfa82c2d5a43b460fcc71c4d03ae539b15602880eda446`

Output manifest: `6faa5d0c6ccab48eee536b0bc4c7e3e39dcae3288dd17069f053f512a819ffae`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Hoh Glacier | 3.666 | 3.741 | 3.741 | 0.980 | 1.000 | 0.839 / 0.903 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Hubert Glacier | 0.849 | 0.627 | 0.627 | 1.354 | 1.000 | 0.644 / 0.922 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Humes Glacier | 1.620 | 1.361 | 1.361 | 1.190 | 1.000 | 0.836 / 0.997 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ice River Glacier | 0.334 | 0.218 | 0.218 | 1.533 | 1.000 | 0.630 / 0.979 | glims-2015-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Jeffers Glacier | 0.471 | 0.202 | 0.202 | 2.329 | 1.000 | 0.428 / 0.998 | glims-2015-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Queets Glacier | 0.446 | 0.293 | 0.293 | 1.525 | 1.000 | 0.636 / 0.982 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Eel Glacier | 0.848 | 0.820 | 0.820 | 1.034 | 1.000 | 0.856 / 0.938 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Hanging Glacier | 0.076 | 0.061 | 0.061 | 1.257 | 1.000 | 0.743 / 0.962 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Anderson Glacier | 0.130 | 0.013 | 0.013 | 10.165 | 1.000 | 0.087 / 0.898 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Carrie Glacier | 0.494 | 0.499 | 0.499 | 0.990 | 1.000 | 0.664 / 0.794 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Cameron Glaciers | 0.340 | 0.193 | 0.193 | 1.764 | 1.000 | 0.529 / 0.956 | osm ⚑ | OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent |
| Blue Glacier | 4.986 | 5.137 | 5.111 | 0.976 | 1.005 | 0.864 / 0.913 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2015-09-09: 12 matched systems; 115 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1987-09-09-reference: 7 matched systems; 157 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1985-09-09-reference: 4 matched systems; 76 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1979-09-09-reference: 0 matched systems; 2 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1976-09-09-reference: 0 matched systems; 6 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1968-09-09-reference: 0 matched systems; 1 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1943-09-09-reference: 1 matched systems; 6 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
