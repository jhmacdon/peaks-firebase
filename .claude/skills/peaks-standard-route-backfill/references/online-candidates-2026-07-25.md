# Washington Online Route Candidates — 2026-07-25

Audit rule: a listed Washington summit is missing a standard route when it has
no linked route with `owner = 'peaks'` and `status = 'active'`.

Route descriptions support route identity only. Geometry comes from the listed
OpenStreetMap ways and is subject to ODbL. The five strong candidates below
were imported as pending on 2026-07-25; pending routes are not current standard
routes and do not appear in public route queries.

## Strong Candidates

| Peak | Peaks id | Lists | Proposed route | Exact-way result | Review |
|---|---|---|---|---|---|
| Red Mountain | `xoddbMqeMfYKTs8odJqo` | Smoot's 100; Washington Home Court 100 | Red Mountain via Old Commonwealth Trail and West Slope | 2.95 mi one way; 10 m trailhead snap; 18 m summit snap | Pending `kITDGZD46PeJPvaHRdaX`; shorter than WTA's stated route, so keep the Old Commonwealth variation explicit |
| Cashmere Mountain | `ROKasI5D2Q6LxibDFdqE` | Bulger List; Smoot's 100 | Cashmere Mountain via Lake Caroline and West Ridge | 9.05 mi one way; 48 m trailhead snap; 104 m summit snap | Pending `OLbQiCsS3cLdoAT205dY`; final way is informal |
| Dragontail Peak | `UQoFhMv2O9DG6c3WkadM` | Bulger List; Smoot's 100 | Dragontail Peak via Aasgard Pass and East Slopes | 6.17 mi one way; 44 m trailhead snap; 7 m summit snap | Pending `aX7LBoa1jYzmRRfFX7TT` |
| Mount Maude | `gl7egY5YdxonJ72KZBmZ` | Bulger List; Smoot's 100 | Mount Maude via Leroy Creek and South Ridge | 7.65 mi one way; 7 m trailhead snap; 3 m summit snap | Pending `7fQPvW8jGOSslUQ0hs9G`; use admin segment review with Seven Fingered Jack before activation; access roads were closed for the Little Giant Fire on 2026-07-24 |
| Seven Fingered Jack | `2mtqzljXaDujZT0AwIFY` | Bulger List; Smoot's 100 | Seven Fingered Jack via Leroy Creek and Southwest Slope | 6.12 mi one way; 7 m trailhead snap; 10 m summit snap | Pending `AZSymCh65kDH98Bdyp4Q`; `foot=yes` overrides the summit way's generic `access=no`; use admin segment review with Mount Maude; same 2026-07-24 road closure |

### Exact OSM ways

- Red Mountain: `1436009439`, `241579731`, `1225943553`,
  `1225943554`, `530916428`, `1172957728`, `308933988`
- Cashmere Mountain: `1321868105`, `1321868106`, `150227745`,
  `328892288`, `575387229`
- Dragontail Peak: `1219407739`, `1219407738`, `5838047`,
  `310632646`, `854796770`, `235696406`, `854796771`, `340350765`,
  `310632679`, `310632640`, `844433058`, `235696395`, `1084352602`,
  `563923575`, `632018379`
- Mount Maude: `180346437`, `1082530193`, `360215410`, `944482658`,
  `1082527973`, `360220764`
- Seven Fingered Jack: `180346437`, `1082530193`, `360215410`,
  `361357235`

## OSM Geometry Approval

An independent Terra agent ran `$peaks-osm-route-approval` against current OSM
on 2026-07-25. All five pending routes passed. Each stored core line had 100%
of samples within 3 m of its cited ways, a rounded maximum and p95 offset of
0.00 m, and used every cited way.

| Route | Result | Endpoint connectors | Samples | Ways | Note |
|---|---|---:|---:|---:|---|
| Red Mountain `kITDGZD46PeJPvaHRdaX` | Geometry approved | 10.0 m / 17.6 m | 466 | 7/7 | No warning |
| Cashmere Mountain `OLbQiCsS3cLdoAT205dY` | Geometry approved | 47.7 m / 103.8 m | 1,061 | 5/5 | No warning |
| Dragontail Peak `aX7LBoa1jYzmRRfFX7TT` | Geometry approved | 44.1 m / 7.3 m | 798 | 15/15 | No warning |
| Mount Maude `7fQPvW8jGOSslUQ0hs9G` | Geometry approved | 6.6 m / 2.9 m | 1,142 | 6/6 | Shared-segment review still required |
| Seven Fingered Jack `AZSymCh65kDH98Bdyp4Q` | Geometry approved | 6.6 m / 0.7 m | 804 | 4/4 | `foot=yes` overrides generic `access=no` on way `361357235`; shared-segment review still required |

This is geometry approval, not activation. The route rows remain pending until
the publication gate below is deployed. Mount Maude and Seven Fingered Jack
also remain pending until the admin segment review handles their shared Leroy
Creek approach.

## Conditional or Rejected

| Peak | Peaks id | Lists | Result | Reason |
|---|---|---|---|---|
| Hibox Mountain | `11Dj1MXI23in2fnW4EjK` | Washington Home Court 100 | 3.34 mi; 31 m trailhead snap; 65 m summit snap | Geometry matches the named climber trail, but WTA asked people to avoid the area during the Three Queens Fire response on 2026-07-17 |
| Eldorado Peak | `6at9owVcoQg6SuPh0ksA` | Bulger List; Smoot's 100 | 3.95 mi; continuous OSM line; 37 m summit snap | Glacier and river-crossing geometry changes; the online line is shorter than the route source and needs strict current-condition review |
| Old Snowy Mountain | `FnWeJhXQdetfKbONaTed` | Smoot's 100 | OSM reaches the summit through a named scramble way | The OSM Snowgrass Trail line starts by Berry Patch, not the standard Snowgrass trailhead. Build a hybrid from the public-domain USGS approach and OSM summit spur, then inspect the join |
| Kachess Ridge | `pv6LEQYVzhcoyvntK2Bm` | Washington Home Court 100 | OSM and public-domain USGS cover Kachess Ridge Trail #1315 | Trailhead snap is 20 m, but the named trail ends 518 m from the catalog summit; do not use the closed boot-path shortcut |
| Ingalls Peak | `8gW9WZ6tngvhNn0TIDpc` | Smoot's 100 | Connected 4.56 mi OSM line via Ingalls Way and Ingalls Lake | Summit snap is 119 m, but the existing Esmeralda trailhead is 427 m from the online line; the start needs a licensed connector |

## Route Identity Sources

- Red Mountain:
  [WTA](https://www.wta.org/go-hiking/hikes/red-mountain-commonwealth-basin),
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/red-pass-mountain-commonwealth-basin),
  [Old Commonwealth route guide](https://www.10adventures.com/hikes/mount-baker-snoqualmie-national-forest/red-mountain-via-old-commonwealth-trail/)
- Cashmere Mountain:
  [Mountaineers route](https://www.mountaineers.org/activities/routes-places/cashmere-8501),
  [west-ridge report](https://www.mountaineers.org/activities/trip-reports/cashmere-mountain-4)
- Dragontail Peak:
  [Mountaineers route](https://www.mountaineers.org/activities/routes-places/enchantments-area-review/colchuck-dragontail-peaks),
  [east-slope report](https://www.mountaineers.org/activities/trip-reports/dragontail-peak-summit-via-the-east-slope-standard-route)
- Mount Maude and Seven Fingered Jack:
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/mount-maude-seven-fingered-jack),
  [WTA Mount Maude](https://www.wta.org/go-hiking/hikes/mount-maude)
- Hibox Mountain:
  [WTA](https://www.wta.org/go-hiking/hikes/hibox-mountain),
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/hibox-mountain)
- Eldorado Peak:
  [NPS climbing rangers](https://www.nps.gov/noca/blogs/east-ridge-9-16-16.htm),
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/north-cascades-national-park-cross-country-zones/high-occupancy-xc-zones/eldorado-peak-inspiration-glacier)
- Old Snowy Mountain:
  [WTA](https://www.wta.org/go-hiking/hikes/old-snowy-mountain-elk-pass),
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/pacific-crest-trail-routes/snowgrass-flat-goat-lake-basin);
  OSM ways `442980345`, `442980344`, `147614857`, `548940147`,
  `1352978238`, `337321382`, `442980341`
- Kachess Ridge:
  [WTA](https://www.wta.org/go-hiking/hikes/kachess-ridge);
  OSM ways `379314466`, `167498627`, `371302997`; USGS object ids
  `1970728`, `1970730`, `1970733`, `1970736`
- Ingalls Peak:
  [Mountaineers](https://www.mountaineers.org/activities/routes-places/ingalls-stuart-area/ingalls-peak-south-ridge);
  OSM ways `236470870`, `236470875`, `236470876`, `694942416`,
  `1213228739`

## Publication Gate

Before any OSM-derived candidate enters Cloud SQL:

1. Store route and segment provenance, attribution, license, retrieval time, and
   exact OSM way ids.
2. Return that data from every route-bearing API.
3. Show OSM attribution and the ODbL link beside every route map.
4. Keep the same metadata in GPX and GeoJSON exports.
5. Provide the derived route data under the ODbL when public use triggers its
   share-alike terms.

Migration `20260725_route_provenance.sql` now enforces the route and segment
record. The API, web, and iOS changes in the same worktree preserve and show it.
Do not activate the pending routes until those app changes are deployed. Mount
Maude and Seven Fingered Jack also need shared-segment review before activation.
