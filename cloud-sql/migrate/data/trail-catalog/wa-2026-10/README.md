# Washington hike seed

`wa-hike-seed.json` holds 409 curated Washington hikes, scrambles and climbs. `rainier-dc-features.json` lists the named points and stretches on the Disappointment Cleaver route from Paradise to Columbia Crest.

## Sources

- Names, routes, distances and gains come from my own knowledge. Treat mileage and gain as a ±25% sanity check only.
- Trail names were checked against the local OSM extract (`raw/washington-latest.osm.pbf`) and the agency layers in `raw/agency/` (USFS, NPS, State Parks). A trail number (`#1599`) is added only when those sources agree on one number for that name.
- A trailing `?` marks a trail name that neither OSM nor the agency layers confirm (62 names, one per entry at most). Most are small city or county park trails, climbers' paths, or beach walks.
- `wta_url` values were matched by slug against `raw/wta-hike-urls.txt` only. No WTA or AllTrails pages were read. Every non-null URL appears verbatim in that file.

## Counts

| Region | Tier 1 | Tier 2 | Tier 3 | Total | With wta_url |
|---|---|---|---|---|---|
| North Cascades | 23 | 16 | 49 | 88 | 80 |
| Snoqualmie | 16 | 14 | 33 | 63 | 58 |
| Mount Rainier | 12 | 17 | 16 | 45 | 41 |
| Olympic Peninsula | 15 | 16 | 14 | 45 | 42 |
| Central Cascades | 9 | 8 | 27 | 44 | 42 |
| Puget Sound and Islands | 7 | 18 | 10 | 35 | 33 |
| South Cascades | 4 | 9 | 14 | 27 | 23 |
| Southwest Washington | 7 | 7 | 4 | 18 | 15 |
| Issaquah Alps | 2 | 3 | 10 | 15 | 14 |
| Eastern Washington | 2 | 6 | 7 | 15 | 13 |
| Central Washington | 3 | 8 | 3 | 14 | 14 |
| **All** | **100** | **122** | **187** | **409** | **375** |

By kind: 200 destination, 126 summit, 76 loop, 7 traverse.

## Doubts

- **Tiers are judgment calls.** No usage data was used. Tier 1 is my best guess at the ~100 most-hiked routes.
- **Region edges.** I followed WTA's region scheme from memory. Teanaway and Salmon La Sac (Lake Ingalls, Mount Stuart) are in Snoqualmie. US-2 west (Lake Serene, Wallace Falls) is in Central Cascades. Boulder Cave (Naches), Mount Aix, Falls Creek Falls, Lewis River Falls, High Rock and Mount Peak could each fall on the other side of a line.
- **WTA slugs matched by name only.** Where both a plain slug and a `-1`/`-2` variant exist, I could not tell which page is which, so I left `wta_url` null (Mount Washington, Rainy Lake, Mount Margaret, Cape Horn, Goat Peak, Cedar Falls, Silver Lake). Some matches are likely but unchecked: `mount-rainier` (put on the DC route), `mt-shuksan` (on Fisher Chimneys), `rampart-ridge-lakes` (Rampart Lakes, I-90), `waptus-river`, `twin-falls-state-park`, `staircase`, `reflection-lakes`, `riverside-state-park` (Bowl and Pitcher), `mount-spokane-state-park-three-peaks-loop`. Two WTA pages each cover two entries (Thornton Lakes / Trappers Peak; Summerland / Panhandle Gap).
- **Access changes.** SR-504 to Johnston Ridge (landslide, 2023), Hurricane Ridge services (lodge fire, 2023), the Grove of the Patriarchs bridge (2021), Bird Creek Meadows (Yakama Nation closure) and the White Chuck Road (Glacier Peak Sitkum approach) may be closed or limited. Each has a note.
- **Climb geometry.** Climbing routes past the trail end (DC, Emmons, Kautz, Coleman-Deming, Easton, Fisher Chimneys, Cascadian Couloir, Eldorado, Forbidden, Olympus, Glacier Peak) follow glaciers and boot paths that move each season. OSM has lines for the DC, Camp Muir, Emmons, Monitor Ridge, Worm Flows and Hogsback routes; the rest will need hand-drawn or GPX-derived lines.
- **Glacier Peak.** One entry ("via Cool Glacier", alias Sitkum) covers the North Fork Sauk / White Pass approach. The Sitkum route via Kennedy Hot Springs is a different line; split it out if you need both.
- **Rainier "Icebox".** Not included. I could not cite a guide or ranger source that names it on the DC route, and OSM has no such feature on Rainier. See `unverified` in `rainier-dc-features.json`.
