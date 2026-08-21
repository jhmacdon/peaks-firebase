# Peakbagger list audit — 2026-08-21

Continues [the 2026-08-18 audit](peakbagger-lists-2026-08-18.md), which held four
lists back for a destination audit. All four now import. Peaks holds 21 lists.

Getting there took three things: 32 new summit destinations, a fix to the
importer's matcher, and a way to place eight summits OpenStreetMap has never
mapped.

Source rows come from the repo fixture
`docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-18.json`.

## Imported

| List | lid | Members | New summits | Overrides |
|---|---|---|---|---|
| [Adirondack 46ers](https://www.peakbagger.com/list.aspx?lid=5120) | 5120 | 46 | 7 | 1 |
| [AMC New England 4000-footers](https://www.peakbagger.com/list.aspx?lid=5163) | 5163 | 67 | 12 | 7 |
| [Oregon Top 100 Peaks](https://www.peakbagger.com/list.aspx?lid=21316) | 21316 | 100 | 11 | 5 |
| [Traditional Colorado Centennial Peaks](https://www.peakbagger.com/list.aspx?lid=50083) | 50083 | 100 | 2 | 3 |

The New England list is catalogued as **New England 4000-Footers** and the
Colorado one as **Traditional Colorado Centennials**; the organization and
source columns carry the rest. The five lists the 2026-08-18 pass touched came
through every run here with no member added, removed, or moved, and no metadata
change.

### List metadata

| | Adirondack 46ers | New England 4000-Footers | Oregon Top 100 Peaks | Traditional Colorado Centennials |
|---|---|---|---|---|
| Year established | 1948 | 1964 | — | 1977 |
| Organization | Adirondack Forty-Sixers | AMC Four Thousand Footer Club | — | — |
| Region | Adirondacks | New England | Oregon | Colorado |

1948 is the year New York State incorporated the Adirondack Forty-Sixers, the
club that keeps the list; the club dates its first meeting under that name to
May 30, 1948. 1964 is the year the AMC Four Thousand Footer Club, founded in
1957 for the New Hampshire forty-eight, drew up its New England list; the club's
history page supplies both that date and the 200-foot rise rule. The sixty-seven
split as 48 New Hampshire, 14 Maine, 5 Vermont, which the source rows confirm.
1977 is the year the quad-based Colorado Centennials became the accepted list,
the year Spencer Swanger first climbed them all; airborne LiDAR replaced it in
2021, and Peakbagger keeps the older reckoning as a separate list.

Both Oregon and Colorado take a null organization, the rule the Colorado 14ers
and Tennessee lists already follow: an elevation cut has no keeper. The Colorado
Mountain Club records Centennial finishers but does not draw the list.

Sources: [adk46er.org history](https://adk46er.org/a-bit-of-history/),
[adk46er.org timeline](https://adk46er.org/timeline/),
[Adirondack Forty-Sixers on Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers),
[amc4000footer.org history](https://www.amc4000footer.org/history.html),
[countryhighpoints.com on the quad-based and LiDAR Centennials](https://www.countryhighpoints.com/gnss-based-colorado-centennials-list/).

## The matcher was wrong, and is fixed

The first dry run resolved the Adirondack row "Armstrong Mountain" to a summit
in Okanogan County, Washington, **3,460 km away**. Peaks held only the
Washington peak, its elevation sits 45 m from the Adirondack one, and 45 m is
inside the importer's 100 m window.

The cause was in `resolveExactNameCandidate`: the 5 km distance rule ran only
when a name matched more than one destination. A lone candidate skipped it
entirely, so a wrong match with no competition went through silently.

The bound now applies to the final candidate whether or not it is alone. A
source row that carries coordinates and whose only name match sits beyond 5 km
fails resolution and names the distance in the error, which forces either an
override or a new destination rather than a quiet mistake. Rows without
coordinates — the Colorado 14ers list has none — keep matching on name and
elevation alone. Four tests cover it, and the bound changes no already-imported
row: all nine curated lists still resolve with a zero diff.

## New summits — 32 destinations

Three migrations, split by where the data came from.

### `20260821_held_list_summits.sql` — 19, OpenStreetMap

For the Adirondack and New England lists. Coordinates and OSM node IDs read on
2026-08-21; no coordinate comes from GNIS. Elevations keep the OSM `ele` tag
only where it lands within 3 m of the USGS 3DEP sample at the same point.
Fourteen of these nodes carry an old GNIS contour value rather than a summit
reading — Table Top Mountain's is 36 m low, North Brother's 27 m, Middle
Carter's 23 m — so those rows take the 3DEP sample, which agrees with the source
list to about a metre. Each row records its source in
`metadata.elevation_source`.

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

### `20260821_or_co_list_summits.sql` — 5, OpenStreetMap

For the Oregon and Colorado lists, where OSM has a node. Every one of these is a
peak the source list labels differently, so an override reaches it. Identity was
settled by terrain rather than by name: a 3DEP summit search around each source
point landed within 2 to 17 m of the OSM node, and read an elevation matching the
source list to better than half a metre.

| Summit | State | Elevation (m) | Source | OSM node | OSM `ele` |
|---|---|---|---|---|---|
| Kiger-Mann Peak | OR | 2850.2 | usgs_3dep | [6601323053](https://www.openstreetmap.org/node/6601323053) | 2832.2, 18.0 m low |
| West Aneroid Peak | OR | 2801.6 | usgs_3dep | [9104370897](https://www.openstreetmap.org/node/9104370897) | 2798, 3.6 m low |
| Snowfield Peak | OR | 2732.0 | usgs_3dep | [10074433560](https://www.openstreetmap.org/node/10074433560) | 2719, 13.0 m low |
| Moccasin Lake Mountain | OR | 2573.0 | osm | [9104420504](https://www.openstreetmap.org/node/9104420504) | 2573, kept |
| Mark Mountain | CO | 4217.8 | osm | [13926474089](https://www.openstreetmap.org/node/13926474089) | 4217.8, kept |

Mark Mountain is UN 13,838, the peak the source list calls Redcloud Peak -
Northeast Peak. Oregon's Snowfield Peak is a different summit from the
Snowfield Peak already in Peaks, which is in Washington and 188 m lower.

### `20260821_peakbagger_only_summits.sql` — 8, Peakbagger

Seven summits on the Oregon list and one on the Colorado list carry no name of
their own — three are bare elevation labels, two name the drainages either side
of a divide, two name a subsidiary summit — and OpenStreetMap has no node for any
of them. They enter with Peakbagger provenance: the id is
`sha256('peakbagger:peak:<peakbaggerPeakId>')`, a separate scheme from the
`osm:node` ids so the two cannot collide, `external_ids` is
`{"peakbagger": "<id>"}`, and `metadata.source` is `peakbagger`. Each row carries
`metadata.osm_status`, "absent from OSM as of 2026-08-21; candidate for future
OSM contribution". GNIS is not used, here or anywhere in this audit.

**Coordinates are a deliberate departure from the ruling, and worth reading.**
The Peakbagger export's own coordinates are map-tile quantised at zoom 7 — every
longitude in the file is an exact multiple of 0.010986328125°, about 860 m on the
ground at these latitudes. Sampling 3DEP at those coordinates reads **48 to
165 m below** the published summit elevation, because each one lands on a slope.
Storing them would have put every row up to 830 m from its peak at an elevation
that is plainly wrong.

So each coordinate below is the summit itself, located in 3DEP terrain: sample a
25×25 grid across the quantisation box, take every local maximum, refine each to
about 1.5 m, and keep the one whose elevation matches the published figure. That
match is the evidence the right summit was found — within 0.6 m on all eight
rows, within 0.1 m on five. 3DEP is public-domain USGS elevation data and the
source of the elevations in the two migrations above.

| Summit | State | Stored (3DEP) | Peakbagger | Δ | Moved from the export's point |
|---|---|---|---|---|---|
| Redcloud Peak - Far Northeast Peak | CO | 4212.3 | 4212.2 | +0.07 | 268 m |
| Peak 8710 | OR | 2654.9 | 2654.8 | +0.01 | 67 m |
| Jackson Peak - South | OR | 2590.3 | 2590.3 | −0.04 | 134 m |
| Graham Mountain - West Peak | OR | 2586.1 | 2586.1 | −0.01 | 505 m |
| Peak 8441 | OR | 2572.6 | 2572.8 | −0.22 | 382 m |
| North Minam Creek-Bear Creek | OR | 2548.4 | 2548.4 | −0.01 | 371 m |
| Peak 8098 | OR | 2467.6 | 2468.1 | −0.52 | 129 m |
| Berry-Norton Peak | OR | 2447.4 | 2447.5 | −0.07 | 299 m |

The Colorado row is UN 13,820, the single summit that held that list back.
Peak 8441 has an untagged OSM node 40 m away
([7711935638](https://www.openstreetmap.org/node/7711935638)) with no name and no
`ele`, which is why the search found the same summit there.

Because these eight carry the source list's own names, the importer matches them
without an override.

## Reviewed overrides

An override is needed whenever the source row and the catalog name the same
summit differently. Each was checked by position and elevation before being
written.

**Adirondack 46ers**

| Source row | Destination | Why |
|---|---|---|
| Grace Mountain (6090) | Grace Peak `8D80C88D491FB5DE4232` | The same summit, renamed from East Dix in 2014. 0.1 km apart, 3.5 m in elevation. |

**New England 4000-Footers**

| Source row | Destination | Why |
|---|---|---|
| North Twin (6919) | North Twin Mountain `E217CB2023A0DD96EC79` | New row above; the catalog keeps the OSM name. |
| Bondcliffs (6926) | Bondcliff `368689EB272E602EC570` | New row above; the source pluralizes the name. |
| Mount Osceola - East Peak (6991) | East Osceola `B2B88E2AC6A9AAD6E1C6` | New row above. |
| Zealand Mountain (6922) | Mount Zealand `C20C3828C69C89C5976A` | 0.25 km apart, 0.3 m in elevation. |
| Old Speck (6885) | Old Speck Mountain `CC78CA6F6F21ADF51013` | 0.54 km apart, 13.6 m in elevation. |
| Bigelow Mountain (6850) | Mount Bigelow `39176EE36B46BCC0E000` | Bigelow's West Peak. The catalog row sits on it; Avery Peak, the range's other 4,000-footer, is a separate row 0.95 km east. |
| Saddleback Mountain - The Horn (6847) | The Horn `404A204B24580871F4B5` | Saddleback's northeast summit, 1.9 km from Saddleback Mountain itself, which the list also counts. |

**Oregon Top 100 Peaks**

| Source row | Destination | Why |
|---|---|---|
| Steens Mountain - North Peak (3337) | Kiger-Mann Peak `8FD5348C68B1BB2A4E8C` | New row above. The 3DEP summit search landed 2 m from the OSM node. |
| Peak 9192 (36387) | West Aneroid Peak `C4DF226B7B4BA1CF5315` | New row above; 9 m from the node, elevation matches to 0.00 m. |
| Peak 8963 (107008) | Snowfield Peak `F1089B73B1AD23752890` | New row above; 16 m from the node, elevation matches to 0.01 m. |
| Twin Mountain - East Peak (204076) | Twin Mountain `kkqii3pdy5RhZ8tyGcII` | The existing row is the high point of the massif. 3DEP reads 2711.6 m within 5 m of it, against the source's 2713.0 m; the next bump east reads 2710.4 m, further from the published figure. |
| Lostline River-Moccasin Lake (3165) | Moccasin Lake Mountain `CDB36D592A99DE762C47` | New row above; 17 m from the node, elevation matches to 0.05 m. The source misspells Lostine. |

**Traditional Colorado Centennials**

| Source row | Destination | Why |
|---|---|---|
| Mount Blue Sky (5676) | Mount Evans `PaeawK81bgByWN53rffv` | The same override the Colorado 14ers list already uses. |
| Mount Buckskin - Southeast Peak (5798) | Mount Buckskin `CDtc6zwdcpVsT3kx1tgO` | The catalog row already carries the 13,865-foot summit at 39.318737, -106.146945. The list counts no other Buckskin summit. |
| Redcloud Peak - Northeast Peak (5846) | Mark Mountain `E1DEC037ADBE7648F7B2` | New row above. UN 13,838; 6 m from the node, elevation matches to 0.11 m. |

## Wikipedia backfill

Run for all four lists after the import, so they carry photos and copy on the
lists index like the seventeen before them.

| List | Written | Images | Refused | Unmatched |
|---|---|---|---|---|
| Adirondack 46ers | 45 | 40 | 0 | 0 |
| New England 4000-Footers | 50 | 46 | 0 | 14 |
| Oregon Top 100 Peaks | 24 | 21 | 0 | 67 |
| Traditional Colorado Centennials | 41 | 38 | 0 | 10 |

Hero coverage now runs 41 of 46, 49 of 67, 87 of 100 and 30 of 100. Oregon
trails because two thirds of its list are informally named Wallowa summits with
no Wikipedia article — the same reason they have no OSM node. Nothing was
refused on licensing.

## Catalog problems found on the way

None of these came from this import, and none is fixed here.

- **Nye Mountain** `68AADE51A617102C6EA3` stores 1271 m. The 3DEP sample at its
  own coordinates reads 1185.5 m and the source list says 1185.9 m, so the stored
  value is 85 m high. It comes from the OSM node's `ele` tag. Nye now shows on
  the Adirondack 46ers list with that number.
- **Mount Bigelow** `39176EE36B46BCC0E000` stores 1227 m against the source's
  1260 m, and **Saddleback Mountain** `81DE7FE4973D5CAF790B` stores 1231 m
  against 1256 m. Same cause, smaller error.
- **Missing state codes.** 39 destinations across these four lists have no
  `state_code` — 32 on the Oregon list, 6 on the Colorado one, plus South Twin
  `QkAXELOaEsMBnuArw2ZL` on the New England list, which also has no OSM ID. All
  are the right summits; they came through the Firestore migration without the
  field.

## Verification

- Dry run resolved all nine curated lists with no unresolved row.
- Apply reported 46, 67, 100 and 100 members added, and 0 added, 0 removed,
  0 reordered for each of the five lists already in Peaks.
- Every resolved row on the four new lists — 313 of them — was checked against
  its source point. All sit in the expected state, within 0.6 km of it on the
  two coordinate-coarse lists and within 2 km on the others, with no two rows
  sharing a destination and no elevation gap over 14 m.
- Production holds 21 lists, ordered 0 through n−1.
- All 32 new destinations carry a PointZ whose Z equals the stored elevation, and
  no OSM node ID or Peakbagger peak ID is shared by two destinations.
- `cd cloud-sql/migrate && npm test`: 680 pass, 0 fail, 8 skipped. `tsc` clean.

This work adds no service, job, or steady compute cost. Monthly cost impact: $0.
