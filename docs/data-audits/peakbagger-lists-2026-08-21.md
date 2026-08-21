# Peakbagger list audit — 2026-08-21

Continues [the 2026-08-18 audit](peakbagger-lists-2026-08-18.md), which held four
lists back for a destination audit. Two of them now import. Two cannot, and the
reason is the same in both: the source list counts summits that OpenStreetMap has
never mapped.

Source rows come from the repo fixture
`docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-18.json`.
New summits come from `cloud-sql/migrations/20260821_held_list_summits.sql`.

## Imported

- [Adirondack 46ers](https://www.peakbagger.com/list.aspx?lid=5120): 46 of 46.
  Seven summits were new to Peaks; one row uses a reviewed override.
- [AMC New England 4000-footers](https://www.peakbagger.com/list.aspx?lid=5163):
  67 of 67, catalogued as **New England 4000-Footers**. Twelve summits were new
  to Peaks; seven rows use reviewed overrides.

Peaks now holds 19 lists. The five lists the 2026-08-18 pass touched came through
this run with no member added, removed, or moved, and no metadata change.

### List metadata

| | Adirondack 46ers | New England 4000-Footers |
|---|---|---|
| Year established | 1948 | 1964 |
| Organization | Adirondack Forty-Sixers | AMC Four Thousand Footer Club |
| Region | Adirondacks | New England |

1948 is the year New York State incorporated the Adirondack Forty-Sixers, the club
that keeps the list; the club's own timeline dates its first meeting under that
name to May 30, 1948. 1964 is the year the AMC Four Thousand Footer Club, founded
in 1957 for the New Hampshire forty-eight, drew up its New England list. The
club's history page supplies both the 1964 date and the 200-foot rise rule. The
sixty-seven split as 48 New Hampshire, 14 Maine, 5 Vermont, which the source rows
confirm.

Sources: [adk46er.org history](https://adk46er.org/a-bit-of-history/),
[adk46er.org timeline](https://adk46er.org/timeline/),
[Adirondack Forty-Sixers on Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers),
[amc4000footer.org history](https://www.amc4000footer.org/history.html).

## New summits — 19 destinations

Coordinates and OSM node IDs read from OpenStreetMap on 2026-08-21. No coordinate
comes from GNIS.

Elevations keep the OSM `ele` tag only where it lands within 3 m of the USGS 3DEP
sample (EPQS) at the same point. Fourteen of these nodes carry an old GNIS contour
value rather than a summit reading — Table Top Mountain's is 36 m low, North
Brother's 27 m, Middle Carter's 23 m — so those rows take the 3DEP sample, which
agrees with the source list to about a metre. Five rows keep the OSM tag. Each row
records its own source in `metadata.elevation_source`.

| Summit | State | Elevation (m) | Source | OSM node |
|---|---|---|---|---|
| Armstrong Mountain | NY | 1355.3 | usgs_epqs | [357545178](https://www.openstreetmap.org/node/357545178) |
| Table Top Mountain | NY | 1348.1 | usgs_epqs | [357592172](https://www.openstreetmap.org/node/357592172) |
| Macomb Mountain | NY | 1342.1 | usgs_epqs | [357598246](https://www.openstreetmap.org/node/357598246) |
| Phelps Mountain | NY | 1268.0 | osm | [357576773](https://www.openstreetmap.org/node/357576773) |
| Seymour Mountain | NY | 1255.6 | usgs_epqs | [357589061](https://www.openstreetmap.org/node/357589061) |
| Sawteeth | NY | 1254.0 | usgs_epqs | [4299228062](https://www.openstreetmap.org/node/4299228062) |
| South Dix | NY | 1247.8 | usgs_epqs | [357590152](https://www.openstreetmap.org/node/357590152) |
| North Twin Mountain | NH | 1452.0 | osm | [357730481](https://www.openstreetmap.org/node/357730481) |
| Middle Carter Mountain | NH | 1407.1 | usgs_epqs | [357730372](https://www.openstreetmap.org/node/357730372) |
| West Bond | NH | 1376.8 | usgs_epqs | [1348521471](https://www.openstreetmap.org/node/1348521471) |
| South Carter Mountain | NH | 1350.9 | usgs_epqs | [357730765](https://www.openstreetmap.org/node/357730765) |
| Bondcliff | NH | 1300.0 | osm | [357730899](https://www.openstreetmap.org/node/357730899) |
| East Osceola | NH | 1268.1 | usgs_epqs | [357729942](https://www.openstreetmap.org/node/357729942) |
| North Tripyramid | NH | 1267.5 | usgs_epqs | [1331580889](https://www.openstreetmap.org/node/1331580889) |
| Middle Tripyramid | NH | 1253.1 | usgs_epqs | [1331579182](https://www.openstreetmap.org/node/1331579182) |
| Wildcat D | NH | 1238.0 | osm | [5550578026](https://www.openstreetmap.org/node/5550578026) |
| North Brother | ME | 1262.0 | usgs_epqs | [358222401](https://www.openstreetmap.org/node/358222401) |
| Avery Peak | ME | 1243.4 | usgs_epqs | [358222318](https://www.openstreetmap.org/node/358222318) |
| South Crocker Mountain | ME | 1228.0 | osm | [358227076](https://www.openstreetmap.org/node/358227076) |

Two naming notes. **East Osceola** carries the name the AMC list and every White
Mountain guide use; its OSM node holds the bare GNIS label "East Peak", which
three other Peaks destinations already answer to, and Wikidata Q5329122 calls it
"East Peak Mount Osceola". **Sawteeth's** neighboring node
[4299228063](https://www.openstreetmap.org/node/4299228063), "Sawteeth-Southeast
Peak", is deliberately left out: it is a shoulder 400 m away and no reviewed list
names it.

### Armstrong Mountain, and a match that was wrong

The dry run resolved the Adirondack row "Armstrong Mountain" to a summit in
Okanogan County, Washington, 3,383 km away. Peaks held only the Washington peak,
its elevation sits 45 m from the Adirondack one, and 45 m is inside the importer's
100 m window. The importer reaches for its 5 km distance rule only when a name
matches more than one summit, so a single wrong candidate goes through unchallenged.

The fix is the real peak: with the Adirondack Armstrong Mountain in the catalog the
row has two candidates, the distance rule fires, and the New York summit wins.

Every one of the 113 resolved rows was then checked against its source point: all
sit in the expected state and within 2 km of it, and no two rows share a destination.

## Reviewed overrides

An override is needed whenever the source row and the catalog name the same summit
differently. Each was checked by position and elevation before being written.

Adirondack 46ers:

| Source row | Destination | Why |
|---|---|---|
| Grace Mountain (6090) | Grace Peak `8D80C88D491FB5DE4232` | The same summit, renamed from East Dix in 2014. 0.1 km apart, 3.5 m in elevation. |

New England 4000-Footers:

| Source row | Destination | Why |
|---|---|---|
| North Twin (6919) | North Twin Mountain `E217CB2023A0DD96EC79` | New row above; the catalog keeps the OSM name. |
| Bondcliffs (6926) | Bondcliff `368689EB272E602EC570` | New row above; the source pluralizes the name. |
| Mount Osceola - East Peak (6991) | East Osceola `B2B88E2AC6A9AAD6E1C6` | New row above. |
| Zealand Mountain (6922) | Mount Zealand `C20C3828C69C89C5976A` | 0.25 km apart, 0.3 m in elevation. |
| Old Speck (6885) | Old Speck Mountain `CC78CA6F6F21ADF51013` | 0.54 km apart, 13.6 m in elevation. |
| Bigelow Mountain (6850) | Mount Bigelow `39176EE36B46BCC0E000` | Bigelow's West Peak. The catalog row sits on it; Avery Peak, the range's other 4,000-footer, is a separate row 0.95 km east. |
| Saddleback Mountain - The Horn (6847) | The Horn `404A204B24580871F4B5` | Saddleback's northeast summit, 1.9 km from Saddleback Mountain itself, which the list also counts. |

## Held: Oregon Top 100

[Oregon Top 100 Peaks](https://www.peakbagger.com/list.aspx?lid=21316) counts
several summits that carry no name of their own. OpenStreetMap has no node for
them, so Peaks cannot source a coordinate for them under the OSM-first rule, and
the importer cannot drop a row it fails to resolve.

Six rows have nothing to resolve to:

| Row | Source name | Nearest OSM peak node |
|---|---|---|
| 51 | Peak 8710 | none named within 2 km; one unnamed node 1.2 km away with no elevation |
| 65 | Jackson Peak - South | only Jackson Peak itself, which is row 59 |
| 66 | Graham Mountain - West Peak | none within 2 km |
| 75 | North Minam Creek-Bear Creek | none within 3.5 km |
| 90 | Peak 8098 | none within 2.5 km |
| 97 | Berry-Norton Peak | Green Mountain, 1.4 km away and 124 m lower |

Four more rows have a candidate but not a clear one: Steens Mountain - North Peak
(Kiger-Mann Peak, 0.31 km, 18 m below), Peak 8963 (Snowfield Peak at 0.35 km and
an unnamed node at 0.37 km), Twin Mountain - East Peak (the existing Twin Mountain
row at 0.61 km and an unnamed node at 0.45 km), and Peak 8441 (an unnamed node at
0.39 km).

Two are ready when the rest are: Peak 9192 matches
[West Aneroid Peak](https://www.openstreetmap.org/node/9104370897) at 0.36 km and
3.6 m, and Lostine River-Moccasin Lake matches
[Moccasin Lake Mountain](https://www.openstreetmap.org/node/9104420504) at 0.12 km
and 0.2 m.

## Held: Traditional Colorado Centennial Peaks

[Traditional Colorado Centennial Peaks](https://www.peakbagger.com/list.aspx?lid=50083)
is one row short. Three of its four unmatched rows are ready:

- Mount Blue Sky (5676) takes the existing Mount Evans row
  `PaeawK81bgByWN53rffv`, the same override the Colorado 14ers list already uses.
- Mount Buckskin - Southeast Peak (5798) takes the existing Mount Buckskin row
  `CDtc6zwdcpVsT3kx1tgO`, which already carries the 13,865-foot summit at
  39.318737, -106.146945. The list counts no other Buckskin summit.
- Redcloud Peak - Northeast Peak (5846) is UN 13,838, mapped as
  [Mark Mountain](https://www.openstreetmap.org/node/13926474089) at 4217.8 m —
  0.3 m from the source elevation.

Redcloud Peak - Far Northeast Peak (5845) is UN 13,820, and OpenStreetMap holds no
node for it. A search of every node within 4 km carrying a name, an `ele` tag, or a
`natural` tag returns three: Mark Mountain, Grassy Mountain, and Redcloud Peak
itself. Peaks holds nothing nearer than Cooper Creek Peak, 3.5 km away. One row,
and the list waits on it.

## Catalog problems found on the way

None of these came from this import, and none is fixed here. Each sits on a row
that predates it.

- **Nye Mountain** `68AADE51A617102C6EA3` stores 1271 m. The 3DEP sample at its own
  coordinates reads 1185.5 m and the source list says 1185.9 m, so the stored value
  is 85 m high. It comes from the OSM node's `ele` tag. Nye now shows on the
  Adirondack 46ers list with that number.
- **Mount Bigelow** `39176EE36B46BCC0E000` stores 1227 m against the source's
  1260 m, and **Saddleback Mountain** `81DE7FE4973D5CAF790B` stores 1231 m against
  1256 m. Same cause, smaller error.
- **South Twin** `QkAXELOaEsMBnuArw2ZL` has no state code and no OSM ID. It is the
  right summit — 0.27 km from the source point, 0.7 m in elevation — but it came
  through the Firestore migration without either field.

## Verification

- Dry run resolved all seven curated lists with no unresolved row.
- Apply reported 46 and 67 members added, and 0 added, 0 removed, 0 reordered for
  each of the five lists already in Peaks.
- Production holds 19 lists. Adirondack 46ers has 46 members, New England
  4000-Footers 67, both ordered 0 through n−1.
- All 19 new destinations carry a PointZ whose Z equals the stored elevation, and
  no OSM node ID is now shared by two destinations.
- `cd cloud-sql/migrate && npm test`: 676 pass, 0 fail, 8 skipped.

This work adds no service, job, or steady compute cost. Monthly cost impact: $0.
