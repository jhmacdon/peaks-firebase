# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `bd10c33d43077db746795b18b46d178d97214cc374d14c95569ab24f2f13a967`

Output manifest: `cd919987e45ca535890e9c37a86c7b772cf4da8a5e4165810d3139b4e23deb93`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Quien Sabe Glacier | 0.736 | 0.708 | 0.708 | 1.039 | 1.000 | 0.872 / 0.950 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Klawatti Glacier | 1.807 | 1.841 | 1.841 | 0.981 | 1.000 | 0.953 / 0.967 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Katsuk Glacier | 0.726 | 0.723 | 0.723 | 1.004 | 1.000 | 0.953 / 0.978 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mesahchie Glacier | 0.351 | 0.374 | 0.374 | 0.939 | 1.000 | 0.898 / 0.917 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Kimtah Glacier | 0.543 | 0.639 | 0.639 | 0.851 | 1.000 | 0.808 / 0.827 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Fremont Glacier | 0.910 | 0.831 | 0.831 | 1.096 | 1.000 | 0.884 / 0.983 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Boston Glacier | 5.913 | 6.064 | 6.064 | 0.975 | 1.000 | 0.953 / 0.964 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Spire Glacier | 0.741 | 0.688 | 0.688 | 1.077 | 1.000 | 0.884 / 0.975 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Dome Glacier | 0.973 | 0.998 | 0.998 | 0.975 | 1.000 | 0.959 / 0.967 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Sahale Glacier | 0.156 | 0.149 | 0.149 | 1.045 | 1.000 | 0.717 / 0.854 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Lyall Glacier | 0.046 | 0.030 | 0.030 | 1.545 | 1.000 | 0.450 / 0.790 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Davenport Glacier | 0.269 | 0.350 | 0.350 | 0.767 | 1.000 | 0.745 / 0.755 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Cache Glacier | 0.196 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Perdition Glacier | 0.248 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Neve Glacier | 3.946 | 3.822 | 3.822 | 1.032 | 1.000 | 0.916 / 0.972 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Inspiration Glacier | 4.555 | 4.110 | 4.110 | 1.108 | 1.000 | 0.799 / 0.936 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Middle Cascade Glacier | 1.123 | 1.060 | 1.060 | 1.059 | 1.000 | 0.884 / 0.966 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Kindy Glacier | 0.562 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Backbone Glacier | 0.970 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Forbidden Glacier | 1.130 | 1.231 | 1.231 | 0.918 | 1.000 | 0.861 / 0.887 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Eldorado Glacier | 1.271 | 1.814 | 1.814 | 0.701 | 1.000 | 0.589 / 0.631 | osm | OSM/facts ratio is within [0.67, 1.5] |
| McAllister Glacier | 4.284 | 4.368 | 4.368 | 0.981 | 1.000 | 0.889 / 0.932 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Thunder Glacier | 0.198 | 0.131 | 0.131 | 1.510 | 1.000 | 0.591 / 0.933 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Chickamin Glacier | 3.811 | 3.970 | 3.970 | 0.960 | 1.000 | 0.911 / 0.934 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Blue Glacier | 0.234 | 0.225 | 0.225 | 1.044 | 1.000 | 0.918 / 0.978 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Dana Glacier | 2.010 | 2.141 | 2.141 | 0.939 | 1.000 | 0.904 / 0.921 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Le Conte Glacier | 1.819 | — | 1.904 | 0.955 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Snowking Glacier | 0.942 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Douglas Glacier | 1.008 | 0.662 | 0.662 | 1.523 | 1.000 | 0.526 / 0.870 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Banded Glacier | 0.284 | 0.277 | 0.277 | 1.024 | 1.000 | 0.824 / 0.914 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Borealis Glacier | 0.796 | 0.732 | 0.732 | 1.087 | 1.000 | 0.833 / 0.949 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Spider Glacier | 0.431 | 0.428 | 0.428 | 1.007 | 1.000 | 0.807 / 0.896 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Yawning Glacier | 0.201 | 0.124 | 0.124 | 1.621 | 1.000 | 0.469 / 0.837 | glims-2015-09-09 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| S Glacier | 0.233 | 0.163 | 0.163 | 1.426 | 1.000 | 0.622 / 0.930 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Sandalee Glacier | 0.408 | — | 0.412 | 0.990 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Goode Glacier | 0.388 | — | 0.482 | 0.805 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Wyeth Glacier | 0.487 | 0.523 | 0.523 | 0.932 | 1.000 | 0.785 / 0.849 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Mutchler Glacier | 0.819 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Goat Creek Glacier | 0.567 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| South Cascade Glacier | 1.687 | — | 1.800 | 0.937 | — | — / — | osm | OSM/facts ratio is within [0.67, 1.5] |
| Buckner Glacier | 0.460 | 0.452 | 0.452 | 1.016 | 1.000 | 0.885 / 0.946 | osm | OSM/facts ratio is within [0.67, 1.5] |
| North Klawatti Glacier | 1.424 | 1.335 | 1.335 | 1.067 | 1.000 | 0.899 / 0.978 | osm | OSM/facts ratio is within [0.67, 1.5] |

- glims-2015-09-09: 31 matched systems; 248 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1985-09-09-reference: 0 matched systems; 3 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1983-09-09-reference: 0 matched systems; 26 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1974-09-09-reference: 0 matched systems; 5 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1968-09-09-reference: 1 matched systems; 19 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1963-09-09-reference: 0 matched systems; 10 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1959-09-09-reference: 0 matched systems; 3 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- glims-1958-09-09-reference: 33 matched systems; 361 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
