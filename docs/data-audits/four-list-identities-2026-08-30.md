# Four list identity audit — 2026-08-30

A first read-only production dry run checked each saved source row against the Peaks summit catalog. It made no database changes. The importer requires one exact name-and-elevation match inside each list's country or state bounds, unless a reviewed override pins the catalog row.

| List | Members | First pass | Fail-closed rows | Final dry run |
| --- | ---: | ---: | ---: | ---: |
| Classic 8000-Meter Peaks | 14 | 14 | 0 | 14 / 14 |
| UIAA Alpine 4000ers | 82 | 52 | 30 | 82 / 82 |
| Munros | 282 | 213 | 69 | 282 / 282 |
| New Hampshire 52 With a View | 54 | 16 | 38 | 54 / 54 |

The Classic 8000-Meter Peaks list now resolves all fourteen members. Ten old catalog rows lacked country codes, so the importer pins those exact-name identities and keeps the geographic bound strict.

The other three lists first failed closed. A zero below means no exact scoped match existed at the time. A value above zero means that many catalog rows matched and needed a reviewed identity choice.

The completed review pins all 137 rows in [the resolution fixture](./fixtures/four-list-identity-resolutions-2026-08-30.json). It reuses 85 catalog destinations and adds 52 named OSM summits: four UIAA peaks, ten Munros, and 38 New Hampshire peaks. Clearing those rows exposed two distinct Munros named Carn Liath that had shared one catalog destination. The final plan pins both and adds the separate 975-meter OSM summit, bringing the total to 53 new destinations.

The final command ran against production through a transaction-level read-only connection and omitted `--apply`. It returned 82, 282, and 54 unique destinations for the three lists. No production rows changed.

## UIAA Alpine 4000ers

All 30 initial failures are resolved: 26 reviewed aliases point to existing destinations and four Aiguilles du Diable summits use new OSM nodes. The official UIAA list supplies their identities and heights. Peakbagger currently places Pointe Carmen and Pointe Médiane in the opposite spatial order; the mapping follows the same-name OSM nodes, UIAA heights, and the documented ridge order.

- 10043 — Monte Rosa (0 candidates)
- 10041 — Nordend (0 candidates)
- 10045 — Signalkuppe (0 candidates)
- 10038 — Liskamm (0 candidates)
- 10037 — Liskamm - West Summit (0 candidates)
- 9944 — Pic Luigi Amadeo (0 candidates)
- 10046 — Parrotspitze (0 candidates)
- 10023 — Grand Combin (0 candidates)
- 9939 — Dôme du Goûter (0 candidates)
- 9932 — Grandes Jorasses (0 candidates)
- 18883 — Grand Combin de Valsorey (0 candidates)
- 19102 — Grandes Jorasses - Pointe Whymper (0 candidates)
- 10034 — Breithorn (0 candidates)
- 10035 — Breithorn - Central Summit (0 candidates)
- 88874 — Breithorn - Eastern Summit (0 candidates)
- 18884 — Grand Combin de la Tsessette (0 candidates)
- 88779 — Aiguilles du Diable - L'Isolée (0 candidates)
- 9943 — Aiguille Blanche (0 candidates)
- 35251 — Pointe Croz (0 candidates)
- 88806 — Breithorn - East Gendarme (0 candidates)
- 88778 — Aiguilles du Diable - Pointe Médiane (0 candidates)
- 88780 — Aiguilles du Diable - Pointe Carmen (0 candidates)
- 88781 — Aiguilles du Diable - Pointe Chaubert (0 candidates)
- 35253 — Pointe Marguerite (0 candidates)
- 9940 — Aiguille de Bionassay (0 candidates)
- 35252 — Pointe Elena (0 candidates)
- 9968 — Grosses Grünhorn (0 candidates)
- 10051 — Dürrenhorn (0 candidates)
- 9946 — Punta Baretti (0 candidates)
- 88873 — Barre des Écrins - Dôme de Neige (0 candidates)

## Munros

All 69 initial failures are resolved: 59 reviewed aliases point to existing destinations and ten use new OSM nodes. The Scottish Mountaineering Club list supplies the names and heights. Two extra overrides keep the 1,006-meter and 975-meter Carn Liath rows distinct; the lower summit adds OSM node `304798882`.

- 9215 — Beinn a' Bhuird (0 candidates)
- 9205 — Ben Avon (0 candidates)
- 9239 — Lochnagar (0 candidates)
- 9249 — Geal - Charn (2 candidates)
- 9193 — A' Chralaig (0 candidates)
- 9259 — Stob Coire Easain (2 candidates)
- 9252 — Aonach Beag (0 candidates)
- 9180 — Tom a' Choinich (0 candidates)
- 9242 — Carn a' Choire Boidheach (0 candidates)
- 9168 — Beinn Dearg (2 candidates)
- 15249 — Beinn a' Chaorainn (2 candidates)
- 15296 — Braigh Coire Chruinn-bhalgain (0 candidates)
- 9167 — An Teallach (0 candidates)
- 20990 — An Teallach-Sgurr Fiona (0 candidates)
- 9173 — Liathach (0 candidates)
- 6489 — Geal Charn (2 candidates)
- 20373 — Beinn a' Chaorainn (2 candidates)
- 21182 — Sgurr Fhuar-thuill (0 candidates)
- 19454 — Carn Dearg (3 candidates)
- 9191 — Ben Attow (0 candidates)
- 14302 — Ben Challum (0 candidates)
- 14061 — Beinn a' Bheithir - Sgorr Dhearg (0 candidates)
- 21131 — Liathach-Mullach an Rathain (0 candidates)
- 9279 — Buachaille Etive Mor (0 candidates)
- 21040 — Mullach Clach a' Bhlair (0 candidates)
- 21073 — Carn an Tuirc (0 candidates)
- 14056 — Beinn Eighe - Ruadh-stac Mor (0 candidates)
- 9245 — Beinn Dearg (3 candidates)
- 19361 — Beinn Fhionnlaidh (2 candidates)
- 14614 — Sgurr Mor (2 candidates)
- 14994 — Beinn a' Bheithir-Sgorr Dhonuill (0 candidates)
- 15058 — Stob Bàn (2 candidates)
- 15673 — A' Chailleach (2 candidates)
- 14497 — Sgor na h-Ulaidh (0 candidates)
- 19288 — Beinn Eighe-Spidean Coire nan Clach (0 candidates)
- 15664 — Carn nan Gobhar (2 candidates)
- 21183 — Carn nan Gobhar (2 candidates)
- 9243 — Gaor Bheinn (0 candidates)
- 14086 — Beinn Alligin - Sgurr Mhor (0 candidates)
- 19160 — Inaccessible Pinnacle (0 candidates)
- 9300 — Ben Vorlich (2 candidates)
- 21005 — Meall na Aighean (0 candidates)
- 19168 — Stob Ban (2 candidates)
- 9274 — Aonach Eagach - Sgor nam Fiannaidh (0 candidates)
- 21215 — Sgurr na Banachdich (0 candidates)
- 14065 — Sgurr Thuilm (2 candidates)
- 9159 — Ben Klibreck - Meall nan Con (0 candidates)
- 14327 — Beinn Fhionnlaidh (2 candidates)
- 14429 — Buachaille Etive Beag - Stob Dubh (0 candidates)
- 15330 — Sgurr nan Coireachan (2 candidates)
- 15464 — Sgurr nan Coireachan (2 candidates)
- 21196 — Buachaille Etive Mor - Stob na Broige (0 candidates)
- 14076 — Beinn Bhuidhe (2 candidates)
- 9210 — Carn Dearg (3 candidates)
- 14346 — Meall Buidhe (2 candidates)
- 15637 — An Socach (2 candidates)
- 14068 — Ben Vorlich (2 candidates)
- 15410 — Carn Dearg (3 candidates)
- 14540 — Meall Buidhe (2 candidates)
- 21057 — Beinn Bhreac (2 candidates)
- 9136 — Blabheinn (0 candidates)
- 21230 — A' Chailleach (2 candidates)
- 21085 — Geal Charn (2 candidates)
- 19156 — Buachaille Etive Beag - Stob Coire Raineach (0 candidates)
- 21064 — Beinn Alligin-Tom na Gruagaich (0 candidates)
- 21022 — An Socach (2 candidates)
- 21249 — Carn Sgulain (0 candidates)
- 19285 — Ruadh Stac Mor (2 candidates)
- 19261 — Geal-charn (3 candidates)

## New Hampshire 52 With a View

All 38 initial failures use new OSM nodes. The official 2025 keeper list supplies the identities and heights, including both summits in the Doublehead and Welch–Dickey pairs. The keeper says those heights come from the 2019 statewide LiDAR survey, with added data from NH GRANIT.

- 18307 — Sugarloaf (0 candidates)
- 6890 — Mount Success (0 candidates)
- 12517 — Jennings Peak (0 candidates)
- 12612 — Stairs Mountain (0 candidates)
- 18308 — Percy Peaks - North Peak (0 candidates)
- 136676 — Mount Resolution - Southwest Summit (0 candidates)
- 12524 — Magalloway Mountain (0 candidates)
- 12565 — Mount Tremont (0 candidates)
- 12621 — Three Sisters - Middle Sister (0 candidates)
- 12480 — Cherry Mountain - Owlshead (0 candidates)
- 6946 — North Moat Mountain (0 candidates)
- 12515 — Imp Face (0 candidates)
- 12533 — Mount Crawford (0 candidates)
- 32002 — Mount Paugus - South Peak (0 candidates)
- 12573 — North Doublehead (0 candidates)
- 12604 — South Doublehead (0 candidates)
- 23548 — Eagle Crag (0 candidates)
- 12552 — Mount Parker (0 candidates)
- 28966 — Rogers Ledge (0 candidates)
- 6733 — Mount Cube (0 candidates)
- 12614 — Stinson Mountain (0 candidates)
- 6929 — Mount Willard (0 candidates)
- 12462 — Black Mountain (0 candidates)
- 12605 — South Moat Mountain (0 candidates)
- 12516 — Iron Mountain (0 candidates)
- 12491 — Dickey Mountain (0 candidates)
- 23554 — Welch Mountain (0 candidates)
- 12584 — Potash Mountain (0 candidates)
- 42616 — Table Mountain (0 candidates)
- 23550 — Mount Israel (0 candidates)
- 6893 — Mount Hayes (0 candidates)
- 12554 — Mount Pemigewasset (0 candidates)
- 12508 — Hedgehog Mountain (0 candidates)
- 12526 — Middle Sugarloaf (0 candidates)
- 25448 — Bald Peak (0 candidates)
- 6949 — Pine Mountain (0 candidates)
- 12555 — Mount Percival (0 candidates)
- 12549 — Mount Morgan (0 candidates)

## Evidence and cost

- UIAA identities and heights: [UIAA Alpine 4000ers](https://www.theuiaa.org/4000-alps/) and its [official summit PDF](https://www.theuiaa.org/documents/mountaineering/UIAA_MOUNTAINEERING_4000ERS.pdf).
- Munro identities and heights: [Scottish Mountaineering Club hills list](https://www.smc.org.uk/hills/).
- New Hampshire identities and heights: [Over the Hill Hikers official 2025 list](https://overthehillhikers.blogspot.com/p/official-52-with-view-list.html).
- Source coordinates: each public Peakbagger peak page, recorded by Peakbagger ID in the resolution fixture.
- Destination coordinates and OSM identities: each linked OpenStreetMap node in the resolution fixture.

This is importer data and reviewed mapping logic only. It adds no service, job, timer, or always-on resource. Run-rate change: **$0/month**.
