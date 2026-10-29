# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `d447663033d1462737b6a8d401772d6fa488a7b5509b599c3f8cfbc9b20a2c9c`

Output manifest: `7077914899279f0c8fa1129b42ffb2b3d088f2df296a9737e3c3793564e34ebc`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Colchuck Glacier | 0.200 | 0.112 | 0.112 | 1.788 | 1.000 | 0.531 / 0.967 | glims-2015-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Sherpa Glacier | 0.071 | 0.061 | 0.061 | 1.179 | 1.000 | 0.751 / 0.935 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Stuart Glacier | 0.102 | 0.113 | 0.113 | 0.902 | 1.000 | 0.887 / 0.894 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ice Cliff Glacier | 0.063 | 0.067 | 0.067 | 0.941 | 1.000 | 0.890 / 0.914 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Snow Creek Glacier | 0.136 | 0.036 | 0.036 | 3.779 | 1.000 | 0.248 / 0.949 | glims-2015-09-09 | OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1 |
| Hinman Glacier | 0.207 | 0.278 | 0.278 | 0.746 | 1.000 | 0.686 / 0.711 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lynch Glacier | 0.742 | 0.480 | 0.480 | 1.547 | 1.000 | 0.580 / 0.935 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Overcoat Glacier | 0.456 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Chimney Glacier | 0.318 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Foss Glacier | 0.329 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |

- glims-2015-09-09: 7 matched systems; 47 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1963-09-09-reference: 0 matched systems; 7 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1958-09-09-reference: 2 matched systems; 22 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1957-09-09-reference: 5 matched systems; 26 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Outline overlaps

No pair of final outlines overlaps by more than 1% of the smaller or 0.01 km².
