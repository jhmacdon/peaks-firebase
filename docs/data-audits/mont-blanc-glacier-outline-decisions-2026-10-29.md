# Glacier outline decisions

Rule 2: OSM extents are undated; without dated evidence of OSM's age an out-of-band OSM outline gives way to the newest dated licence-OK candidate closer to the facts area, unless a reviewed decision keeps OSM. Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).

Areas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.

Input manifest: `e6d524ea8133ad4c57a7f948f2fbfbb6e06641635d4db3b91205222c5c3cd28f`

Output manifest: `522908808212c1e2b814ecdf418b0ccd856d6785df91c1ddb54fbd711139091b`

| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Glacier des Rognons | 1.765 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Grands Montets | 0.094 | — | 0.103 | 0.915 | — | 0.816 / 0.861 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Chardonnet | 0.751 | — | 0.730 | 1.029 | — | 0.762 / 0.878 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Trident | 0.076 | — | 0.041 | 1.876 | — | 0.438 / 0.876 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier des Améthystes | 1.199 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Rouges du Dolent | 0.320 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Saleinaz | 5.308 | — | 6.131 | 0.866 | — | 0.817 / 0.839 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier d'Orny | 0.472 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier du Trient | 0.510 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Bionnassay | 3.836 | — | 3.754 | 1.022 | — | 0.864 / 0.937 | osm | OSM/facts ratio is within [0.67, 1.5]; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm |
| Glacier de Taconnaz | 0.978 | — | 3.192 | 0.306 | — | 0.274 / 0.281 | osm ⚑ | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2); neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm (overlap between sources) |
| Ghiacciaio di Pré de Bar | 2.456 | — | 2.718 | 0.904 | — | 0.873 / 0.887 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio della Lex Blanche | 2.482 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio del Freney | 1.134 | — | 0.952 | 1.190 | — | 0.828 / 0.992 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio del Brouillard | 1.354 | — | 1.107 | 1.223 | — | 0.748 / 0.951 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio di Triolet | 3.320 | — | 3.266 | 1.017 | — | 0.820 / 0.908 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Dolent | 0.951 | — | 1.069 | 0.889 | — | 0.876 / 0.882 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de la Charpoua | 0.347 | — | 0.317 | 1.095 | — | 0.819 / 0.943 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio di Fréboudze | 1.456 | — | 1.809 | 0.805 | — | 0.766 / 0.783 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Dôme - Ghiacciaio del Dôme | 2.021 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm |
| Glacier de Bionnassay - Ghiacciaio di Bionassay | 1.013 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm |
| Glacier des Glaciers | 1.225 | — | 1.188 | 1.031 | — | 0.905 / 0.965 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio d'Estellette | 0.372 | — | 0.298 | 1.250 | — | 0.765 / 0.975 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Leschaux | 3.261 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Miage | 1.190 | — | 1.097 | 1.085 | — | 0.878 / 0.975 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier des Pèlerins | 1.370 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Blaitière | 0.548 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier du Nant Blanc | 0.709 | — | 0.572 | 1.240 | — | 0.774 / 0.977 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Tacul | 2.474 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de la Verte | 0.053 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Tête Rousse | 0.097 | — | 0.070 | 1.375 | — | 0.686 / 0.966 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Trélaporte | 0.158 | — | 0.137 | 1.153 | — | 0.714 / 0.897 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de la Thendia | 0.051 | — | 0.045 | 1.134 | — | 0.692 / 0.873 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier Rond | 0.093 | — | 0.093 | 1.006 | — | 0.757 / 0.864 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Capucin | 0.191 | — | 0.111 | 1.720 | — | 0.544 / 0.958 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier de Pierre Joseph | 0.325 | — | 0.297 | 1.093 | — | 0.656 / 0.829 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de l'A Neuve | 2.274 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio du Chatelet | 0.076 | — | 0.040 | 1.902 | — | 0.488 / 0.951 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Mer de Glace | 1.868 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de la Griaz | 0.225 | — | 0.200 | 1.125 | — | 0.874 / 0.991 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Lognan | 0.190 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de la Pendant | 0.165 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier du Milieu | 0.333 | — | 0.326 | 1.021 | — | 0.847 / 0.927 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Tour Noir | 0.553 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio Orientale del Petit Mont Blanc | 0.135 | — | 0.117 | 1.147 | — | 0.780 / 0.941 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier d'Armancette | 0.711 | — | 0.591 | 1.205 | — | 0.804 / 0.983 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Covagnet | 0.432 | — | 0.309 | 1.396 | — | 0.656 / 0.949 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de la Bérangère | 0.086 | — | 0.093 | 0.929 | — | 0.578 / 0.706 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio del Gruetta | 0.234 | — | 0.150 | 1.561 | — | 0.631 / 0.991 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier de Planpincieux | 1.129 | — | 1.001 | 1.127 | — | 0.871 / 0.990 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Pra Sec | 0.162 | — | 0.124 | 1.301 | — | 0.740 / 0.979 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Tronchey | 0.056 | — | 0.071 | 0.789 | — | 0.754 / 0.769 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier des Grandes Jorasses | 0.648 | — | 0.601 | 1.078 | — | 0.790 / 0.917 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du petit Mont Gruettaz | 0.037 | — | 0.012 | 3.194 | — | 0.313 / 1.000 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Ghiacciaio occidental du Mont Gruettaz | 0.337 | — | 0.243 | 1.384 | — | 0.700 / 0.982 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de Rochefort | 0.611 | — | 0.547 | 1.118 | — | 0.831 / 0.961 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier de l'Aiguille de Tré-la-Tête Orientale | 0.168 | — | 0.141 | 1.189 | — | 0.744 / 0.934 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Col du Miage | 0.098 | — | 0.080 | 1.226 | — | 0.756 / 0.958 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Moine | 0.009 | — | 0.014 | 0.619 | — | 0.399 / 0.461 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Ghiacciaio di Toula | 0.579 | — | 0.490 | 1.182 | — | 0.806 / 0.973 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Col des Dômes | 0.141 | — | 0.105 | 1.342 | — | 0.512 / 0.793 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Ghiacciaio di Entreves | 0.141 | — | 0.057 | 2.479 | — | 0.402 / 0.998 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier Oriental de l'Aiguille Blanche | 0.039 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| Glacier Septentrional des Aiguilles Blanches | 0.172 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier du Gendarme Rouge | 0.072 | — | — | — | — | — / — | osm ⚑ | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm; original OSM overlaps Glacier des Bossons; retained and flagged, no clip |
| Glacier de Combalet | 0.053 | — | — | — | — | — / — | osm ⚑ | No individual facts area; retain OSM for review |
| La Vallée Blanche | 3.961 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm |
| Glacier du Géant | 10.682 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Bossons | 14.092 | — | 11.643 | 1.210 | — | 0.730 / 0.932 | osm ⚑ | OSM/facts ratio is within [0.67, 1.5]; neighbour group Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons resolved all-osm; original OSM overlaps Glacier du Gendarme Rouge; retained and flagged, no clip |
| Glacier du Tour | 6.283 | — | 8.124 | 0.773 | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio del Monte Bianco | 1.765 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio del Miage | 4.858 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier d'Argentière | 7.337 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier d'Envers du Plan | 0.696 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Grands | 1.187 | — | 1.293 | 0.918 | — | 0.865 / 0.890 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier du Bourgeat | 0.196 | — | 0.044 | 4.464 | — | 0.219 / 0.981 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier de Tré-la-Tête | 6.869 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio del Petit Mont Blanc | 0.887 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Ghiacciaio della Brenva | 5.164 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Berons | 0.077 | — | 0.110 | 0.701 | — | 0.651 / 0.671 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Glacier d'Envers de Blaitière | 0.602 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier des Nantillons | 0.231 | — | 0.379 | 0.611 | — | 0.508 / 0.543 | alps2015 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Glacier des Périades | 1.870 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Plateau du Trient | 5.303 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier du Mont Mallet | 2.843 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Glacier de Talèfre | 5.896 | — | 6.648 | 0.887 | — | 0.821 / 0.851 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Unnamed glacier (way 363120277) | 0.544 | — | 0.488 | 1.116 | — | 0.865 / 0.981 | osm | OSM/facts ratio is within [0.67, 1.5] |
| Unnamed glacier (way 1394999701) | 0.206 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Unnamed glacier (way 1394999702) | 0.140 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |
| Unnamed glacier (way 1394999703) | 0.038 | — | 0.339 | 0.111 | — | 0.111 / 0.111 | sgi2023 | OSM ratio outside band; OSM extent undated, so the newest dated licence-OK candidate with a ratio closer to 1 replaces it (rule 2) |
| Unnamed glacier (relation 1649757) | 0.148 | — | — | — | — | — / — | osm | Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline |

- alps2015: 47 matched systems; 0 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.
- sgi2023: 5 matched systems; 0 unmatched groups/features; 0 ambiguous; 0 invalid. Full identities and reasons are in JSON.

## Combined inventory rows

These figures belong in this decision table, not in member catalog facts. Parent counts use the member places.

| Inventory row | Date | Area km² | Members | OSM total km² | Ratio | Inventory covered | Choice | Facts flag |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| 2873; 585; 588; 594 | 2015-08-29; 2015-08-29; 2015-08-29; 2015-08-29 | 7.369 | Glacier de Tré-la-Tête | 6.869 | 0.932 | 86.9% | osm | facts: combined rows |
| 2872; 589 | 2015-08-29; 2015-08-29 | 3.210 | Ghiacciaio del Petit Mont Blanc, Ghiacciaio della Lex Blanche | 3.369 | 1.050 | 97.3% | osm | facts: combined rows |
| 602; 697 | 2015-08-29; 2015-08-29 | 10.249 | Ghiacciaio del Monte Bianco, Unnamed glacier (relation 1649757), Ghiacciaio del Miage, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay | 9.804 | 0.957 | 89.0% | osm | facts: combined rows |
| 2879; 625; 639 | 2015-08-29; 2015-08-29; 2015-08-29 | 1.068 | Glacier des Pèlerins | 1.370 | 1.283 | 91.7% | osm | facts: combined rows |
| 636; 640; 650 | 2015-08-29; 2015-08-29; 2015-08-29 | 0.430 | Glacier de Blaitière | 0.548 | 1.275 | 95.3% | osm | facts: combined rows |
| 641; 645 | 2015-08-29; 2015-08-29 | 0.565 | Glacier d'Envers de Blaitière | 0.602 | 1.066 | 96.0% | osm | facts: combined rows |
| 717 | 2015-08-29 | 1.017 | Glacier du Tour Noir, Glacier des Rouges du Dolent | 0.873 | 0.858 | 74.7% | osm | facts: combined rows |
| 831; 857 | 2015-08-29; 2015-08-29 | 6.897 | Glacier du Tour | 6.283 | 0.911 | 88.8% | osm | facts: combined rows |
| 2880 | 2015-08-29 | 0.399 | Glacier de Lognan, Glacier de la Pendant | 0.355 | 0.889 | 80.8% | osm | facts: combined rows |
| 3143 | 2015-08-29 | 28.803 | La Vallée Blanche, Glacier du Géant, Glacier des Périades, Glacier du Mont Mallet, Glacier d'Envers du Plan, Mer de Glace, Glacier de Leschaux, Glacier du Tacul | 27.656 | 0.960 | 91.7% | osm | facts: combined rows |
| 3165 | 2015-08-29 | 5.952 | Ghiacciaio della Brenva, Glacier Septentrional des Aiguilles Blanches, Glacier du Gendarme Rouge | 5.408 | 0.909 | 78.7% | osm | facts: combined rows |
| 3192 | 2015-08-29 | 11.235 | Glacier d'Argentière, Glacier des Rognons, Glacier des Améthystes, Glacier de la Verte | 10.355 | 0.922 | 88.5% | osm | facts: combined rows |
| B85-07; B85-08; B85-26 | 2023; 2023; 2023 | 2.709 | Glacier de l'A Neuve | 2.274 | 0.839 | 80.0% | osm | facts: combined rows |
| B85-23; B90-02 | 2023; 2023 | 6.656 | Plateau du Trient, Glacier d'Orny, Glacier du Trient | 6.285 | 0.944 | 93.7% | osm | facts: combined rows |
| B85-13 | 2023 | 0.489 | Unnamed glacier (way 1394999701), Unnamed glacier (way 1394999702) | 0.346 | 0.708 | 70.7% | osm | facts: combined rows |

## Outline overlaps

| Pair | Overlap km² | Of smaller | Resolution | Group | Note |
| --- | ---: | ---: | --- | --- | --- |
| Glacier de Bionnassay / Glacier de Taconnaz | 0.013 | 0.4% | all-osm | 7: Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons | All 7 on OSM: 2 of 7 ratios in band (OSM 2, inventory n/a); 1 original OSM overlaps remain flagged; no clip |
| Glacier de Taconnaz / Glacier des Bossons | 2.145 | 67.2% | all-osm | 7: Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons | All 7 on OSM: 2 of 7 ratios in band (OSM 2, inventory n/a); 1 original OSM overlaps remain flagged; no clip |
| Glacier du Gendarme Rouge / Glacier des Bossons | 0.072 | 99.0% | all-osm | 7: Glacier de Bionnassay, Glacier de Taconnaz, Glacier du Dôme - Ghiacciaio del Dôme, Glacier de Bionnassay - Ghiacciaio di Bionassay, Glacier du Gendarme Rouge, La Vallée Blanche, Glacier des Bossons | All 7 on OSM: 2 of 7 ratios in band (OSM 2, inventory n/a); 1 original OSM overlaps remain flagged; no clip |
