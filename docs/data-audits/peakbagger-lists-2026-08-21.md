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

### Sources for every claim in the four descriptions

The descriptions ship to users, so each factual claim in them is listed here with
what backs it. "Source rows" means the fixture this import reads.

**Adirondack 46ers**

| Claim | Source |
|---|---|
| Bob and George Marshall and Herbert Clark climbed all forty-six | [adk46er.org history](https://adk46er.org/a-bit-of-history/); [Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers) |
| between 1918 and 1925 | Whiteface on 1 August 1918, Emmons on 10 June 1925 — [adk46er.org history](https://adk46er.org/a-bit-of-history/) |
| four of the forty-six fall under 4,000 feet | Blake, Cliff, Nye, Couchsachraga — [Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers) |
| one 4,000-foot summit was skipped | MacNaughton Mountain — [Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers) |
| the club kept the original list | kept "out of tradition" — [Wikipedia](https://en.wikipedia.org/wiki/Adirondack_Forty-Sixers) |
| Mount Marcy is the highest point in New York and tops the list | source row 1, 5,343.6 ft |

**New England 4000-Footers**

| Claim | Source |
|---|---|
| the AMC Four Thousand Footer Club drew up the New England list in 1964 | [amc4000footer.org history](https://www.amc4000footer.org/history.html) |
| it carried the New Hampshire forty-eight into Maine and Vermont | same page; the club was founded in 1957 for the NH 48 |
| 4,000 feet plus 200 feet above the saddle | same page — the 200-foot rule set at the 1957 map party |
| sixty-seven peaks today | source rows: 67, splitting 48 NH / 14 ME / 5 VT by the export's own region field |
| Mount Washington tops it | source row 1, 6,286.5 ft |

**Oregon Top 100 Peaks**

| Claim | Source |
|---|---|
| Mount Hood is the highest point in Oregon | source row 1; [Wikipedia](https://en.wikipedia.org/wiki/Mount_Hood) |
| the list runs down to a shade under 8,000 feet | source row 100, Mount Harriman, 7,988.8 ft; Peaks stores 7,979.0 ft |
| the Cascade volcanoes take the top places | source rows 1–5: Hood, Jefferson, South Sister, North Sister, Middle Sister |
| the Wallowas hold the largest share | 44 of the 100 source rows fall in the Wallowa bounding box; the next largest block is 15 |
| twenty borrow their name from a nearby landmark, most often a lake | 20 of the 100 source rows are named for an adjacent feature: lake 11, creek 3, ridge 2, and one each for a basin, a pass, a pond, and a flat/saddle. "Landmark" is deliberately open — an earlier draft enumerated "lake, creek, basin, pass, or ridge", which silently dropped the pond and the flat/saddle |
| five carry nothing but an elevation | 5 source rows named `Peak ⟨elevation⟩`: Peak 9192, 8963, 8710, 8441, 8098 |

Mount Hood's height is **deliberately not quoted**. The National Geodetic Survey
endorsed 3,429 m (11,249 ft) in 1991 from a 1986 measurement, but 11,239 ft and
11,240 ft are both still in circulation, and Peaks itself stores 3,426 m
(11,240 ft) — so any figure in the copy would have argued with the number shown
beside it on the page. An earlier draft said 11,244 ft, which matches no
published figure at all; it came from rounding the export's 11,243.7 ft.

**Traditional Colorado Centennials**

| Claim | Source |
|---|---|
| Colorado's hundred highest, counting only those rising 300 feet above the saddle | [countryhighpoints.com](https://www.countryhighpoints.com/gnss-based-colorado-centennials-list/) — "the 100 highest peaks in Colorado with at least 300 feet of prominence" |
| the older reckoning came from the USGS quadrangle surveys | same page — theodolite and photogrammetry measurements off the quads |
| it stood from 1977 until LiDAR replaced it in 2021 | same page — quad-based list accepted 1977–2021; LiDAR flown 2018–19, released 2021 |
| Spencer Swanger was the first to climb them all, in 1977 | same page |
| Mount Elbert leads it | source row 1, 14,439.5 ft |
| Dallas Peak, at 13,809 feet, comes last | source row 100; [countryhighpoints.com](https://www.countryhighpoints.com/colorado-hundred-highest-centennials/) gives the list's floor as 13,809 ft at Dallas Peak, and Peaks stores 4209 m = 13,809.1 ft |

The rule is stated the way the source states it — the hundred highest with 300
feet of rise — rather than as an elevation floor. An earlier draft said "a
hundred summits above 13,810 feet", which contradicted its own next sentence:
the export puts Dallas Peak at 13,810.9 ft but every other source, and the Peaks
catalog, puts it at 13,809 ft.

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
row: the five lists already in Peaks resolve with a zero diff under it, and the
four new ones resolved clean on their first run with it in place.

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
rows, within 0.1 m on six. 3DEP is public-domain USGS elevation data and the
source of the elevations in the two migrations above.

Both coordinates are on the record: the export's tile-quantised point sits in a
per-row `-- export:` comment in the migration beside the 3DEP point that was
stored, and in the table below. Elevations are metres — the 3DEP reading at the
stored point, then Peakbagger's published figure.

| Summit | State | 3DEP | Peakbagger | Δ | Export lat, lng | Stored lat, lng | Moved |
|---|---|---|---|---|---|---|---|
| Redcloud Peak - Far Northeast Peak | CO | 4212.25 | 4212.18 | +0.07 | 37.9528609182, -107.3803710938 | 37.9545950, -107.3782599 | 268 m |
| Peak 8710 | OR | 2654.85 | 2654.84 | +0.01 | 45.1045463098, -117.3339843750 | 45.1051506, -117.3339462 | 67 m |
| Jackson Peak - South | OR | 2590.28 | 2590.31 | −0.03 | 45.1200528415, -117.2790527344 | 45.1188826, -117.2794728 | 134 m |
| Graham Mountain - West Peak | OR | 2586.07 | 2586.08 | −0.01 | 44.2924010853, -118.6523437500 | 44.2960174, -118.6485237 | 505 m |
| Peak 8441 | OR | 2572.63 | 2572.85 | −0.22 | 44.9181392996, -118.2019042969 | 44.9173329, -118.2066090 | 382 m |
| North Minam Creek-Bear Creek | OR | 2548.36 | 2548.37 | −0.01 | 45.2903466247, -117.4877929688 | 45.2925771, -117.4842738 | 371 m |
| Peak 8098 | OR | 2467.63 | 2468.15 | −0.52 | 45.3135290069, -117.4328613281 | 45.3132212, -117.4312731 | 129 m |
| Berry-Norton Peak | OR | 2447.41 | 2447.48 | −0.07 | 44.3238480725, -118.8720703125 | 44.3265232, -118.8723340 | 299 m |

The stored `elevation` column rounds the 3DEP reading to one decimal, matching
the other two migrations.

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

Hero coverage now runs 41 of 46 on the Adirondack list, 49 of 67 on New England,
**87 of 100 on Colorado**, and **30 of 100 on Oregon**. Colorado does well
because most Centennials are named peaks with Wikipedia articles, and its
fourteeners were already covered. Oregon trails because two thirds of its list
are informally named Wallowa summits with no article at all — the same reason
they have no OSM node, and the reason 67 of its rows came back unmatched.
Nothing was refused on licensing.

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

---

# Northeast classics — 2026-08-21, second pass

Four more lists, all in the Northeast: the AMC's New Hampshire 48, the Catskill
3500 Club list, the AMC New England Hundred Highest, and the Northeast 111.
Peaks now holds 25 lists. This pass also clears four small data debts the first
pass wrote down and left.

The new source rows are in a second repo fixture,
`docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-21.json`. It carries
all 26 Peakbagger lists the importer reads. The 22 from the 08-18 file are copied
across unchanged, rows and coordinates alike; the four new ones were read on
2026-08-21.

## Better coordinates

The 08-18 export took each row's position from the list page's map at a fixed
zoom, which quantised every longitude to a multiple of 0.010986° — about 860 m on
the ground. That is what forced the 3DEP summit search behind
`20260821_peakbagger_only_summits.sql`.

The four lists here read coordinates from the feed that map draws from,
`peakbagger.com/Async/LLL.aspx?lid=<id>`, which returns the peak's own latitude
and longitude to five decimals — about a metre. Names, ranks and elevations still
come from the list page table, joined to the feed by peak ID, and each row's
elevation is cross-checked against the feed's own metre value before it is
written. Nothing about the earlier lists was re-read or changed.

Row order in the fixture is the order the page prints. Where the page shows a
tied rank the fixture keeps the position in `ordinal` and records the printed
rank in `sourceRank`; the New England Hundred Highest has one such tie, at 98.

## Imported

| List | lid | Members | New summits | Overrides |
|---|---|---|---|---|
| [AMC New Hampshire 4000-footers](https://www.peakbagger.com/list.aspx?lid=5167) | 5167 | 48 | 0 | 4 |
| [Catskill 3500 Club List](https://www.peakbagger.com/list.aspx?lid=5130) | 5130 | 33 | 9 | 2 |
| [AMC New England Hundred Highest](https://www.peakbagger.com/list.aspx?lid=5165) | 5165 | 100 | 8 | 11 |
| [Northeast "115" 4000-footers](https://www.peakbagger.com/list.aspx?lid=511) | 511 | 115 | 0 | 8 |

Peaks catalogues them as **New Hampshire 4000-Footers**, **Catskill 3500**,
**New England Hundred Highest** and **Northeast 111**.

The four lists overlap heavily, which is why only seventeen destinations were
missing. The membership arithmetic was checked rather than assumed, by peak ID:

- the New Hampshire 48 is a subset of the New England 67 already in Peaks;
- the New England 67 is exactly the top 67 of the Hundred Highest;
- the Northeast 115 is exactly the New England 67 plus the Adirondack 46 plus
  Slide Mountain (7335) and Hunter Mountain (7318), with nothing left over.

So the New Hampshire and Northeast lists needed no new destination at all. The
Catskill list brought nine and the Hundred Highest eight.

### List metadata

| | New Hampshire 4000-Footers | Catskill 3500 | New England Hundred Highest | Northeast 111 |
|---|---|---|---|---|
| Year established | 1957 | 1962 | 1967 | 1971 |
| Organization | AMC Four Thousand Footer Club | Catskill 3500 Club | AMC Four Thousand Footer Club | AMC Four Thousand Footer Club |
| Region | White Mountains | Catskills | New England | Northeast |

Three of the four belong to the AMC Four Thousand Footer Club, which lists all
four of its own challenges — the White Mountain 48, the New England 67, the New
England Hundred Highest and the Northeast 111 Club — on one page and takes an
application for each. The Northeast 111 is the one that needed research: it has
no club of its own, and the AMC page settles it, requiring a finisher to hold
New England Four Thousand Footer and Adirondack 46er membership and to have
climbed Slide and Hunter.

1957 and 1967 come from the club's history page. 1962 is the Catskill 3500
Club's own founding year. **1971 rests on Wikipedia alone** — no AMC page or
club history found gives a date for the Northeast 111 — and is recorded here as
the weakest of the four.

Sources: [amc4000footer.org history](https://www.amc4000footer.org/history.html),
[amc4000footer.org lists we recognize](https://www.amc4000footer.org/the-lists-we-recognize.html),
[amc4000footer.org New England Hundred Highest](https://www.amc4000footer.org/newenglandhundredhighest.html),
[catskill3500club.org](https://www.catskill3500club.org/),
[catskill3500club.org membership](https://www.catskill3500club.org/membership),
[Northeast 111 on Wikipedia](https://en.wikipedia.org/wiki/Northeast_111),
[List of New England Hundred Highest on Wikipedia](https://en.wikipedia.org/wiki/List_of_New_England_Hundred_Highest).
All read 2026-08-21.

### Sources for every claim in the four descriptions

**New Hampshire 4000-Footers**

| Claim | Source |
|---|---|
| the AMC founded its Four Thousand Footer Club in 1957 around this list | [amc4000footer.org history](https://www.amc4000footer.org/history.html) — the sub-committee's March 1957 letter to the AMC Council |
| 4,000 feet plus 200 feet above the saddle | same page — "They decided to use a 200-ft. rule, and the list was accepted by the AMC Council" |
| all forty-eight stand in the White Mountains | the club's own name for the list is the White Mountain Four Thousand Footers ([lists we recognize](https://www.amc4000footer.org/the-lists-we-recognize.html)); Peakbagger's New England export gives Range (Level 4) "White Mountains" for every New Hampshire row |
| Mount Washington is the highest point in the Northeast and tops the list | source row 1, 6,286.5 ft, and rank 1 of all 115 rows across NH, VT, ME and NY |

**Catskill 3500**

| Claim | Source |
|---|---|
| the club has taken members since 1962 | [catskill3500club.org](https://www.catskill3500club.org/) — "The Catskill 3500 Club, founded in 1962" |
| for climbing the highest peaks on public land in the Catskills | same page — "the 33 highest peaks on public lands in the Catskill Mountains" |
| the list held thirty-five until 2021, when Doubletop and Graham closed | [membership page](https://www.catskill3500club.org/membership) — "our tally list has changed from the original list of 35 to the current 33"; the Peakbagger list page dates the change to March 21, 2021 |
| Slide, Blackhead, Balsam and Panther a second time in winter | membership page — "climb Slide, Blackhead, Balsam and Panther mountains again in winter" |

No elevation figure appears in this copy on purpose. The club's list is a
public-land cut rather than a clean 3,500-foot one, and its lowest member, Rocky
Mountain, stores 3,487 ft in Peaks — so "above 3,500 feet" would have argued with
the roster printed beneath it.

**New England Hundred Highest**

| Claim | Source |
|---|---|
| the AMC Four Thousand Footer Club added the list in 1967 | [amc4000footer.org history](https://www.amc4000footer.org/history.html) |
| 200 feet above the saddle | [Wikipedia](https://en.wikipedia.org/wiki/List_of_New_England_Hundred_Highest) — "200 feet (61 m) of topographic prominence" |
| New England's sixty-seven 4,000-footers fill the top | checked by peak ID: the New England 67 is exactly ranks 1–67 of this list |
| the other thirty-three fall just short | source rows 68–100, 3,992.3 ft down to 3,759.4 ft |
| the only one of the club's lists with true bushwhacks | [lists we recognize](https://www.amc4000footer.org/the-lists-we-recognize.html) — "the only list recognized by the Four Thousand Footer Club that contains true bushwhacks" |
| eleven of the thirty-three have no trail | [the club's own 68–100 table](https://www.amc4000footer.org/newenglandhundredhighest.html) marks eleven "no": Vose Spur, Fort, White Cap, Boundary Peak, Mendon Peak, Nubble Peak, East Kennebago, Snow (Cupsuptic), Kennebago Divide, Scar Ridge, Elephant. Two more carry a herd path |

The lowest peak is **deliberately not named**. The AMC's own list ends at the
Cannon Balls NE Peak, 3,769 ft; Peakbagger's elevations reorder the bottom of the
list and end it at Snow Mountain in Maine, 3,759.4 ft. Peaks stores the
Peakbagger order, so naming either one would have contradicted something on the
page.

**Northeast 111**

| Claim | Source |
|---|---|
| New England's sixty-seven, the forty-six Adirondack High Peaks, and Slide and Hunter | the Peakbagger list description says so, and the peak IDs confirm it exactly: 115 = 67 + 46 + 2, with no row outside those three sets |
| it took its name when the count was 111 | [Wikipedia](https://en.wikipedia.org/wiki/Northeast_111) — "This list includes 115 peaks but is still referred to as the 'Northeast 111' because that name predates the additions" |
| two more peaks in New Hampshire and two in Maine | same page — Galehead Mountain and Bondcliff in New Hampshire, Mount Redington and Spaulding Mountain in Maine |
| the AMC Four Thousand Footer Club recognizes finishers, who must first join the New England and Adirondack clubs | [lists we recognize](https://www.amc4000footer.org/the-lists-we-recognize.html) — "To be eligible for the Northeast 111 Club you must be a member of the New England Four Thousand Footer Club, the Adirondack 46ers club and have climbed Slide Mountain and Hunter Mountain" |

State split checked against the stored rows: 48 New Hampshire, 48 New York, 14
Maine, 5 Vermont.

## New summits — 17 destinations

One migration, `20260821_northeast_list_summits.sql`. Every row comes from an
OpenStreetMap `natural=peak` node read on 2026-08-21; no coordinate comes from
GNIS, and no peak here needed the Peakbagger-provenance scheme.

Elevations keep the OSM `ele` tag only where it lands within 3 m of the USGS 3DEP
reading at the summit, and where the two disagreed a 3DEP summit search — an
80 m grid at 20 m spacing, refined to 2.5 m — found the true high point first.

**That rule missed one, and the miss is worth reading.** It compares the tag
against 3DEP *at the node*. A node sitting off the high point reads low in 3DEP
and therefore agrees with its own low tag, so no search runs and the low value
goes in unchallenged. The Bulge did exactly that: tag 1197 m, 3DEP at the node
1197.272 m, agreement to 0.27 m — and 5.5 m below both published figures
(Peakbagger 3,945.2 ft = 1202.50 m, the AMC 3,950 ft = 1203.96 m).

The test that catches this is the published figure, not the node sample. Running
it across all seventeen found The Bulge alone over 3 m out; the next largest is
South Horn at 2.87 m. Its 3DEP summit search puts the high point 18 m from the
node at **1202.391 m**, 0.11 m from Peakbagger's figure, so the tag is an old
contour value and `20260821_the_bulge_elevation.sql` corrects the row to 1202.4,
`usgs_3dep`. Coordinates stay on the OSM node, as they do for the other 3DEP
rows.

After that correction: thirteen rows keep their tag, four take a 3DEP reading,
and six of the seventeen needed a summit search.

| Summit | State | Elevation (m) | Source | OSM node | OSM `ele` |
|---|---|---|---|---|---|
| West Kill Mountain | NY | 1188.1 | osm | [357598566](https://www.openstreetmap.org/node/357598566) | 1188.11, kept |
| Table Mountain | NY | 1165.9 | osm | [357598560](https://www.openstreetmap.org/node/357598560) | 1165.86, kept |
| Sugarloaf Mountain | NY | 1153.1 | osm | [357591726](https://www.openstreetmap.org/node/357591726) | 1153.06, kept |
| Wittenberg Mountain | NY | 1152.8 | osm | [357597623](https://www.openstreetmap.org/node/357597623) | 1152.75, kept |
| Rusk Mountain | NY | 1123.5 | osm | [357583239](https://www.openstreetmap.org/node/357583239) | 1123.49, kept |
| Twin Mountain | NY | 1112.5 | osm | [357593720](https://www.openstreetmap.org/node/357593720) | 1112.52, kept |
| North Dome | NY | 1098.8 | osm | [357574030](https://www.openstreetmap.org/node/357574030) | 1098.80, kept |
| Bearpen Mountain | NY | 1093.3 | osm | [2948777248](https://www.openstreetmap.org/node/2948777248) | 1093.32, kept |
| Rocky Mountain | NY | 1062.8 | osm | [357582635](https://www.openstreetmap.org/node/357582635) | 1062.84, kept |
| South Brother | ME | 1208.0 | osm | [358224250](https://www.openstreetmap.org/node/358224250) | 1208, kept |
| The Bulge | NH | 1202.4 | usgs_3dep | [357728179](https://www.openstreetmap.org/node/357728179) | 1197, 5.4 m low |
| South Weeks Mountain | NH | 1183.0 | osm | [3300692064](https://www.openstreetmap.org/node/3300692064) | 1183, kept |
| East Sleeper | NH | 1177.8 | usgs_3dep | [5512465463](https://www.openstreetmap.org/node/5512465463) | 1170, 7.8 m low |
| Vose Spur | NH | 1172.1 | usgs_3dep | [5257503351](https://www.openstreetmap.org/node/5257503351) | 1177, 4.9 m high |
| East Kennebago Mountain | ME | 1162.4 | usgs_3dep | [358219329](https://www.openstreetmap.org/node/358219329) | 1153, 9.4 m low |
| South Horn | ME | 1159.0 | osm | [358225015](https://www.openstreetmap.org/node/358225015) | 1159, kept |
| Mount Wilson | VT | 1147.0 | osm | [356555348](https://www.openstreetmap.org/node/356555348) | 1147, kept |

The six 3DEP summit searches, node to high point: The Bulge 18 m, Mount Wilson
25 m, East Sleeper 29 m, Wittenberg 38 m, Vose Spur 45 m, East Kennebago 66 m.
With The Bulge corrected, every one of the seventeen stored elevations lands
within 3 m of the source list's published figure — the largest gaps now South
Horn 2.87 m, South Weeks Mountain 1.88 m, Mount Wilson 1.30 m, South Brother
1.11 m, and everything else under 0.6 m.

Two names differ from the source list on purpose.

**South Weeks Mountain** carries the OSM name. The AMC calls it South Weeks and
Peakbagger calls it "Mount Weeks - South Peak", which its own page files as a
sub-peak of Mount Weeks.

**South Horn** is the name the AMC Hundred Highest uses ("Bigelow, South Horn")
for the higher of the two Horns on the Bigelow Range. Its OSM node carries the
bare label "South Peak", which says nothing outside its own ridge; Peakbagger
files the summit under "The Horns" and names South Peak as that peak's highest
summit. Its neighbours [4962752666](https://www.openstreetmap.org/node/4962752666)
("The Horns", no `ele`, 198 m away) and
[4962752665](https://www.openstreetmap.org/node/4962752665) ("North Peak", 318 m)
are deliberately left out: the first is the pair, the second is the lower Horn,
and no reviewed list counts either.

## Reviewed overrides

**New Hampshire 4000-Footers** takes four of the seven the New England list
already uses — North Twin, Bondcliffs, Mount Osceola - East Peak and Zealand
Mountain — reaching the same destinations. The other three are Maine peaks and
do not appear on it.

**Northeast 111** takes all seven of the New England list's overrides plus Grace
Mountain (6090) → Grace Peak `8D80C88D491FB5DE4232`, the one the Adirondack 46ers
already uses.

**Catskill 3500**

| Source row | Destination | Why |
|---|---|---|
| Hunter Mountain - Southwest Peak (7321) | Southwest Hunter Mountain `67817E17AC761CD791CA` | The same summit. 40 m apart, 0.5 m in elevation. |
| Indian Head (18321) | Indian Head Mountain `38F4020BB2AA21456FD3` | 48 m apart, 0.3 m in elevation. |

**New England Hundred Highest** — the seven the New England list uses, plus four:

| Source row | Destination | Why |
|---|---|---|
| Mount Weeks - South Peak (6880) | South Weeks Mountain `AE765CE84B3DEB31202D` | New row above; the catalog keeps the OSM name. |
| The Horns (6852) | South Horn `14FB5A19E9EED147F063` | New row above. Peakbagger's own page for The Horns names South Peak as its highest summit; the OSM node sits 12 m from the source point. |
| Nubble Peak (6917) | Peak Above the Nubble `ED29187EC4534680CEF4` | The same summit. Peakbagger lists "Peak above the Nubble" as an alternate name; 7 m apart. |
| Elephant Mountain - Southwest Peak (6860) | Elephant Mountain `8106CBEB89FCD5BEF1B4` | 17 m apart. The catalog row sits on the southwest peak, which is the summit the AMC list counts, and stores 1150 m against the AMC's 3,772 ft. See the catalog note below. |

## Data debts cleared

`20260821_list_data_debts.sql`. The migration is idempotent and re-running it
writes nothing; it ends in a `DO` block that raises rather than commit a partial
repair.

**Oregon Volcanoes was missing North Sister** while carrying Middle and South.
The destination `zgZKKqtDJJ31aLqtaY2B` has been in Peaks all along — 3,074 m at
44.16655, -121.77234, already on the Cascade Volcanoes and the Oregon Top 100 —
so only the membership row was missing. The USGS Cascades Volcano Observatory,
the list's own cited source, counts North Sister among the Oregon volcanoes. The
list orders by descending elevation from ordinal 0, so the migration re-derives
every ordinal from elevation rather than guessing an insertion point: North
Sister lands at 3, between South Sister (3,157 m) and Middle Sister (3,062 m),
and the list now holds eleven.

Re-deriving rewrites all eleven ordinals, so the ten rows that were already
there had to be shown to keep their places. They do — the full list, read back
from production:

| Ordinal | Peak | Elevation (m) | Row |
|---|---|---|---|
| 0 | Mount Hood | 3426 | pre-existing |
| 1 | Mount Jefferson | 3199 | pre-existing |
| 2 | South Sister | 3157 | pre-existing |
| 3 | **North Sister** | **3074** | **new** |
| 4 | Middle Sister | 3062 | pre-existing |
| 5 | Mount McLoughlin | 2894 | pre-existing |
| 6 | Mount Thielsen | 2799 | pre-existing |
| 7 | Broken Top | 2797 | pre-existing |
| 8 | Mount Bachelor | 2763 | pre-existing |
| 9 | Three Fingered Jack | 2390 | pre-existing |
| 10 | Mount Washington | 2376 | pre-existing |

Strike North Sister and the ten read in exactly the order they held before, with
the same members and nothing else added. The migration's assertions now cover
this rather than leaving it to a one-off read: alongside the count and North
Sister's position, they require the ordinals to be a contiguous 0..n−1 run and
elevation never to rise as ordinal rises. Because no two members share an
elevation, those two together pin every row to one place. Both were checked by
injecting the corruption they exist to catch — swapping Mount Thielsen and
Broken Top, and moving one row's ordinal out of range — and both raised and
rolled back.

**Elbrus had no `country_code`**, so the Seven Summits page counted six countries
instead of seven. The summit stands in Kabardino-Balkaria, Russia; the row's own
coordinates, 43.35381 42.43610, fall well north of the Georgian border. Set to
`RU`.

**South Twin `QkAXELOaEsMBnuArw2ZL`** came through the Firestore migration with
no `state_code`, no `country_code` and no OSM ID. It is a New Hampshire
4000-footer; OpenStreetMap node
[357730793](https://www.openstreetmap.org/node/357730793), "South Twin Mountain",
sits at 44.187565 -71.5548027, 22 m from the stored point. All three fields are
now filled, with the OSM write guarded on that 22 m distance and on no other
destination already holding the node.

**Thirty-nine rows had no `state_code`** — 32 on the Oregon Top 100, 6 on the
Traditional Colorado Centennials, and South Twin. The import did not create
these rows: every one carries `created_at` of 2026-03-13, the Firestore
migration, and came across without the fields. Putting them on a list is what
made the gap visible. All 39 also had no `country_code`, so both are set. Each state comes from
the row's own coordinates and the update only fires when the point falls inside
that state's bounding box, so a wrong pairing writes nothing. Mount Washington in
Oregon `NAAS8YxpeGd9hbnfKk6z` rides along as a fortieth: it carries the same
defect and was the last blank left on the Oregon Volcanoes list the same
migration edits.

## Wikipedia backfill

Run per list after the import.

| List | Written | Images | Refused | Unmatched |
|---|---|---|---|---|
| New Hampshire 4000-Footers | 0 | 0 | 0 | 14 |
| Catskill 3500 | 33 | 24 | 0 | 0 |
| New England Hundred Highest | 28 | 17 | 0 | 23 |
| Northeast 111 | 0 | 0 | 0 | 23 |

Hero coverage now runs 34 of 48 on the New Hampshire list, **24 of 33 on the
Catskills**, 66 of 100 on the Hundred Highest and 92 of 115 on the Northeast 111.
Nothing was refused on licensing.

The two zeroes are not failures. Every New Hampshire 48 peak and every Northeast
111 peak had already been through this backfill on the New England 4000-Footers
or the Adirondack 46ers; the candidates left are the ones Wikipedia has nothing
usable for — no confident article, or an article with no lead image. The
Catskills did best because every one of its thirty-three has an article. Of the
seventeen new summits, thirteen took copy and six took an image.

## Catalog problems found on the way

None of these came from this import, and none is fixed here.

- **Eight more elevations are well off the source list**, in the same class as
  the Nye Mountain and Mount Bigelow entries the first pass recorded. Stored
  against source, in metres: Baldpate Mountain `2A61BD8ECE813387F444` 1090 vs
  1162.9; Goose Eye Mountain `8649C6194440663B730C` 1132 vs 1184.5; Big Jay
  `B9CD1B1A42949CBBD65C` 1115 vs 1151.9; The Cannon Balls `AD8BF1B0F166FCE0CE77`
  1115 vs 1148.2; The Horn (Maine) `404A204B24580871F4B5` 1203 vs 1226.6;
  Donaldson Mountain `A83715D3A92F3172975C` 1238 vs 1259.4; The Horn (New
  Hampshire) `EA5A6DB4A6673F44218B` 1168 vs 1188.8; Gothics
  `A1868E9D39B91E032D9E` 1425 vs 1445.4. All are old OSM `ele` tags carrying a
  contour value rather than a summit reading. Identity is not in doubt in any
  case — every one matched within 170 m. **The Bulge was a ninth**, and the one
  case where this pass created the defect rather than inheriting it; it is fixed
  above, and the rule that let it through is written up with it.
- **Elephant Mountain `8106CBEB89FCD5BEF1B4` is a hybrid row.** Its coordinates
  are the southwest peak's, 17 m from Peakbagger's point for it, but its stored
  1150 m is the whole mountain's height: Peakbagger's LiDAR reading, added in
  June 2022, puts the northeast peak 750 m away at 1150.9 m and the southwest
  peak at 1147.1 m. Peaks holds one Elephant Mountain, the AMC counts one, and
  the override reaches it — but the row's elevation and its position describe two
  different summits.
- **The wider `state_code` gap is larger than the forty rows fixed here.** About
  a hundred more list members still have none, most of them outside the United
  States (Ultras of Iran, the Seven Summits) where the field may not apply, and
  the rest spread across the Washington, Nevada, Utah and Tennessee lists.

## Still deferred

**Munros and other non-US classics.** The Peaks catalog has no UK coverage at
all, so importing the Munros would mean adding 282 destinations before the list
could resolve a single row. That is a product call about opening a new country,
not a list import, and it stays out of scope here as it did on 08-18.

## Verification

- Dry run resolved all thirteen curated lists with no unresolved row, and
  reported 0 added, 0 removed, 0 reordered for each of the nine already in Peaks.
- Apply reported 48, 33, 100 and 115 members added on the four new lists, and the
  same nine zeroes.
- Every stored member on the four lists was checked against its source row: 296
  rows, no destination used twice within a list, every row in the state its
  source names, and 293 of the 296 within 200 m of their source point. The three
  that are not are all on the Hundred Highest, and all multi-summit features
  whose catalog row sits on a neighboring bump: Baldpate Mountain 203 m, Scar
  Ridge 338 m, The Cannon Balls 626 m. Baldpate and The Cannon Balls appear in
  the elevation list below too, from the same cause.
- Production holds 25 lists, and every one of them — not just the four new ones —
  numbers 0 through n−1 with no gap and no repeat.
- All 17 new destinations carry a PointZ whose Z equals the stored elevation, and
  across the whole catalog no OSM node ID is shared by two destinations.
- The data-debt migration's own assertions pass: Oregon Volcanoes holds 11 rows
  with North Sister at ordinal 3, its ordinals are a contiguous 0..10 run in
  descending elevation, no targeted row is left without a `state_code`, Elbrus
  reads `RU`, and South Twin holds OSM node 357730793. Both migrations are
  idempotent — a second run of each wrote nothing.
- The Bulge reads 1202.4 m with `ST_Z` equal to it and
  `elevation_source: usgs_3dep`, and all seventeen new summits now sit within
  3 m of their source list's published elevation.
- `cd cloud-sql/migrate && npm test`: 680 pass, 0 fail, 8 skipped. `tsc` clean.

No source page needed a login and none served a CAPTCHA.

This work adds no service, job, or steady compute cost. Monthly cost impact: $0.

# Western classics — 2026-08-21, third pass

Six lists were researched: the Sierra Club Angeles Chapter's three climbing
sections (Sierra Peaks, Desert Peaks, Hundred Peaks), the Tahoe Ogul Peaks, the
South Beyond 6000, and the Idaho 12ers. **Four were imported and two are held.**
Peaks now holds 29 lists.

The new source rows are in a third repo fixture,
`docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-21b.json`. It
carries all 32 Peakbagger lists the importer reads or has read. The 26 from the
08-21 file are copied across unchanged, rows and coordinates alike, and the six
new ones were read on 2026-08-21 — including the two that are held, so their
research survives the hold.

## Every list ID was verified, not remembered

Peakbagger's list index (`ListIndx.aspx`, 890 lists) was read first and each list
found by name:

| List | lid | Rows on the page |
|---|---|---|
| Sierra Club Sierra Peaks Section | 5051 | 247 |
| Sierra Club Hundred Peaks Section | 5052 | 280 |
| Sierra Club Desert Peaks Section | 5053 | 95 |
| Tahoe-Ogul Peaks List | 5055 | 63 |
| South Beyond 6000 | 5180 | 40 |
| Idaho 11,000-foot Peaks | 21330 | 138 |

**Peakbagger has no Idaho 12,000-foot list.** The index carries eight Idaho
lists and none of them is one; the nearest is the 11,000-foot list above. So the
Idaho 12ers are taken as a named selection from that page rather than as a whole
list — see "A list that takes part of a page" below.

Every row of the five whole lists carries a point in the page's own map marker
feed (`Async/LLL.aspx?lid=`), and every printed elevation agrees with that
feed's metre value to within a metre. No page needed a login and none served a
CAPTCHA.

## Imported

| List | lid | Members | New summits | Overrides |
|---|---|---|---|---|
| [Sierra Club Desert Peaks Section](https://www.peakbagger.com/list.aspx?lid=5053) | 5053 | 95 | 50 | 6 |
| [Tahoe-Ogul Peaks List](https://www.peakbagger.com/list.aspx?lid=5055) | 5055 | 63 | 37 | 5 |
| [South Beyond 6000](https://www.peakbagger.com/list.aspx?lid=5180) | 5180 | 40 | 25 | 3 |
| [Idaho 12ers](https://www.peakbagger.com/list.aspx?lid=21330) (9 of 138 rows) | 21330 | 9 | 0 | 0 |

Peaks catalogues them as **Desert Peaks Section**, **Tahoe Ogul Peaks**,
**South Beyond 6000** and **Idaho 12ers**.

## Held: the Sierra Peaks Section and the Hundred Peaks Section

Both exceed the sixty-destination bound for hand-curated residue, and the
statewide OpenStreetMap expander could not shrink either (see below).

| List | lid | Rows | Already in Peaks | Missing destinations |
|---|---|---|---|---|
| Sierra Peaks Section | 5051 | 247 | 164 | **83** |
| Hundred Peaks Section | 5052 | 280 | 43 | **237** |

The "missing" column counts source rows with no summit destination the importer
could reach: 81 with no candidate at all plus 2 whose only same-named
destination lies beyond the 5 km bound for the Sierra list, and 217 plus 20 for
the Hundred Peaks list. The importer fails closed on every one of them, so
neither list can be half-imported by accident.

The Hundred Peaks Section was the expected hold: 280 Southern California summits,
most of them small chaparral peaks OpenStreetMap has mapped but Peaks has never
had a reason to carry. The Sierra Peaks Section at 83 is the nearer miss, and
worth a dedicated pass — its gap is almost entirely High Sierra summits that
OpenStreetMap does map, so a curated migration of about that size would release
it.

## The statewide expander added nothing, and the reason is in the data

Per the sizing rule the expander ran first for every state the two large lists
touch, and for the states of the smaller ones as well. Dry runs only; nothing
was applied, because there was nothing to apply.

| Scope | Named OSM peaks | Matched before | Unmatched | Coverage | Eligible additions | Deferred for no prominence or popularity signal |
|---|---|---|---|---|---|---|
| US-CA | 6515 | 743 | 5772 | 11.4% | **0** | 5762 |
| US-NV | 1901 | 165 | 1736 | 8.7% | **0** | 1736 |
| US-AZ | 3411 | 135 | 3276 | 4.0% | **0** | 3272 |
| US-NC | 2723 | 81 | 2642 | 3.0% | **0** | 2633 |
| US-TN | 1800 | 45 | 1755 | 2.5% | **0** | 1755 |

The expander adds a peak only when it has an elevation plus either topographic
prominence over 300 ft or a conservative popularity signal. Both come from
Wikidata or from OSM's own tags, and in these states neither is there: of the
2,757 Wikidata entities behind California's 6,515 named peaks, **24 carry a
prominence** and almost none reaches five Wikipedia sitelinks; 130 of the 6,515
OSM nodes carry a `wikipedia` tag at all. So 5,762 of the 5,772 unmatched
California peaks fall at the same gate, and the other four states behave the
same way.

**The prominence floor was not lowered.** Doing so globally would admit
thousands of unreviewed bumps in every state to release two lists, which is the
trade the rule forbids. The finding is that this expander is the wrong
instrument for the desert and the Southern Appalachians: its gate is built for
peaks the wider world has written about, and these are not those peaks.

## A list that takes part of a page

`CuratedList` gained two optional fields, `sourcePeakIds` and `sourceRowCount`,
which only count together. The first names the peaks the list takes; the second
is the row count the whole source page must still have. The Idaho 12ers use
both: nine named rows out of a page of 138.

This keeps the fixture honest — it holds Peakbagger list 21330 exactly as the
page prints it, all 138 rows — while the list definition records which rows Peaks
takes and re-checks that the page has not changed underneath. A page that gains
or loses a row fails the import rather than quietly publishing a stale nine.

## List metadata

| | Desert Peaks Section | Tahoe Ogul Peaks | South Beyond 6000 | Idaho 12ers |
|---|---|---|---|---|
| Year established | 1941 | *(none recorded)* | 1968 | *(none recorded)* |
| Organization | Sierra Club Angeles Chapter | Western States Climbers | Carolina Mountain Club and Tennessee Eastman Hiking and Canoeing Club | *(none)* |
| Region | Desert Southwest | Lake Tahoe | Southern Appalachians | Idaho |

Two years are deliberately absent. The **Tahoe Ogul** list dates from "the early
1980s" and no source found gives a year, so the field stays null rather than
carrying a guess. The **Idaho 12ers** are a plain elevation cut with no keeper,
like the Colorado 14ers already in Peaks, so both the year and the organization
are null.

**South Beyond 6000 carries two organizations in one field** because it has two.
The Carolina Mountain Club hosts the rules and the register, but the club's own
page says the formal sponsors have always been the CMC and the Tennessee Eastman
Hiking and Canoeing Club, and naming only one would be wrong.

The **Tahoe Ogul** organization is the Western States Climbers, not the Sierra
Club. The list was drawn up inside the Sierra Club's Mother Lode Chapter, but
that section disbanded in 1998 and Peakbagger's own list page carries a standing
note that the list is no longer affiliated with the Sierra Club in any way.

### Sources for every claim in the four descriptions

**Desert Peaks Section**

| Claim | Source |
|---|---|
| the Angeles Chapter founded it in 1941 | [desertpeaks.org/about](https://desertpeaks.org/about/) — "The Desert Peaks Section was founded in 1941 by Chester Versteeg and formally organized in October 1945" |
| the oldest peak-climbing section in the chapter | same page — "The oldest peak-climbing section in the largest Chapter of the Sierra Club" |
| ninety-five desert mountains across California, Nevada, Arizona, Utah and Mexico | same page — "Currently 95 desert mountains throughout California, Nevada, Arizona, Utah and Mexico are on our Desert Peaks List"; the source page's 95 rows agree, and its own section headings split them 66 California, 15 Nevada, 9 Arizona, 3 Mexico, 2 Utah |
| six peaks and a Sierra Club membership make a member | same page — "may do so after climbing 6 peaks on the list and joining the Sierra Club" |
| White Mountain Peak, east of the Owens Valley, is the highest | source row 1, 14,244.8 ft; Peaks already carries it on the California Fourteeners, where the stored copy places it east of the Owens Valley |

**Tahoe Ogul Peaks**

| Claim | Source |
|---|---|
| members of the Sierra Club's Peak and Gorge Section drew it up in the early 1980s | [tahoeogul.org history](https://www.tahoeogul.org/history-of-the-oguls/) — "The Ogul list was created in the early 1980s by a group of hikers and climbers in Northern California, who were members of the Peak and Gorge Section within the Mother Lode Chapter of the Sierra Club" |
| sixty-three peaks around Lake Tahoe | the source page's 63 rows, and tahoeogul.org's own subtitle |
| Ogul is the Washoe word for the mountain bighorn sheep | same page — "Ogul is the Washoe Native American word for mountain bighorn sheep" |
| the section disbanded in 1998 | same page — the Peak and Gorge Section was marked inactive by the Mother Lode Chapter in 1998 after voting to disband |
| the Western States Climbers have kept the list since 2000 | same page — the WSC was formed in 2000 by John Bees and John Sarna and maintains the list |
| no Sierra Club tie today | the Peakbagger list page's own standing note, and the history page above |
| fifty-six in California and seven in Nevada | tahoeogul.org's split, **checked independently**: reverse-geocoding all 63 source points against OpenStreetMap boundaries returns exactly 56 California and 7 Nevada |

**South Beyond 6000**

| Claim | Source |
|---|---|
| the CMC and the Tennessee Eastman club have run it since 1968 | [carolinamountainclub.org SB6K](https://www.carolinamountainclub.org/index.cfm/do/pages.view/id/23/page/South-Beyond-6000) — Hugh Thompson of the Tennessee Eastman club began the program in 1968, and "the formal sponsors of the program have always been the Tennessee Eastman Hiking and Canoeing Club and the Carolina Mountain Club" |
| more than sixty summits pass 6,000 feet; forty qualify | same page — "There are over 60 summits in the area above 6000 feet, but only 40 were selected by the criteria" |
| 200 feet to a saddle, or three quarters of a mile | same page — the summit must be above 6000 feet and there must be "a drop of 200 or more feet to a saddle between one peak and another qualifying peak or, there is a distance between the peaks of .75 miles" |
| six ranges: Smokies, Plotts, Balsams, Craggies, Blacks, Roans | same page |
| all but Mount Le Conte in North Carolina or on its Tennessee line | same page — "All 40 are in North Carolina or on the North Carolina-Tennessee border except Mt. Le Conte, which is within Tennessee"; Mount Le Conte is source row 5 |

**Idaho 12ers**

| Claim | Source |
|---|---|
| Idaho holds nine ranked summits above 12,000 feet | [idahoaclimbingguide.com/the-12ers](https://www.idahoaclimbingguide.com/the-12ers/) — "Idaho has only nine ranked summits that lie above 12,000 feet", and it names the same nine the selection takes |
| seven Lost River, one Lemhi, one Pioneer | the source page's own Range column: Borah, Leatherman, Church, Breitenbach, Idaho, Lost River Mountain and Donaldson in the Lost River Range; Diamond Peak in the Lemhi Range; Hyndman Peak in the Pioneer Mountains |
| Borah Peak leads them and is the highest point in the state | source row 1, 12,665.4 ft, and the guide calls it "Idaho's highest peak" |
| two more clear 12,000 feet but rise less than 300 feet above their saddle | the source page carries them as unranked rows: Borah Peak - North Peak at 12,241.2 ft with 163.5 ft of prominence, and Lost River Mountain - North Peak at 12,037.7 ft with 234.9 ft. The lowest peak the selection does take, Donaldson Peak, has 324.7 ft |

All pages read 2026-08-21.

## New summits — 112 destinations

Two migrations, split by provenance the way the Oregon and Colorado pass split
its own: `20260821_western_list_summits.sql` holds the 91 rows OpenStreetMap
maps, and `20260821_western_peakbagger_only_summits.sql` the 21 it does not.

| List | New rows | From OpenStreetMap | Peakbagger provenance |
|---|---|---|---|
| Desert Peaks Section | 50 | 29 | 21 |
| Tahoe Ogul Peaks | 37 | 37 | 0 |
| South Beyond 6000 | 25 | 25 | 0 |

By state: 77 California, 25 North Carolina, 3 Nevada, 3 Arizona, 2 Utah, 2
Mexico. Every state came from reverse-geocoding the stored point against
OpenStreetMap boundaries, not from a bounding box.

### Coordinates: two candidates, and 3DEP picked between them

Each OpenStreetMap row had two candidate points — the OSM node, and the peak's
own point in Peakbagger's list map feed. The 08-18 export could not offer this
choice, because its coordinates were tile-quantised at zoom 7 (about 860 m);
these are not, and across the 371 exact-name matches in this pass the two
sources sit a median of 16 m apart.

USGS 3DEP was sampled at both points, at 1 m resolution, and each row keeps
whichever reads higher, the OSM node winning ties inside 2 m. **The Peakbagger
point wins on 62 of the 91 rows** — by 99 m on Picacho Peak, whose OSM node
sits 148 m off the summit, and by 83 m on Da-ek Dow Go-et Mountain. The OSM node
wins on one row, Raymond Peak, and the two agree within 2 m on the other 28.

Measured at the point each row actually stores, 3DEP lands **within 1 m of the
published elevation on 80 of the 112 rows, within 3 m on 101, and within 10 m on
108**. Two rows are outside that and one pair is unmeasurable; all three are
named under "Catalog problems" below.

### Elevations

An OpenStreetMap `ele` tag is kept only where it lands within 3 m of the figure
the source list publishes. **62 of the 91 tags do not**, and those rows take the
published figure; each row records its own `elevation_source`.

That is the test the Northeast pass's correction identified, and it is used here
instead of the one that failed. Agreement between an OSM tag and a 3DEP sample
*at the OSM node* proves nothing, because a node sitting off the high point
reads low in 3DEP and so agrees with its own low tag — which is how The Bulge
went in 5.5 m under. The published figure is the independent check.

### The 21 rows OpenStreetMap has never mapped

All 21 are on the Desert Peaks list, and 16 of them carry no name of their own
on the ground: they are the high points of named desert ranges (Turtle
Mountains, Whipple Mountains, Sheep Hole Mountains, Palen Mountains, Big Maria
Mountains, Nelson Range, Orocopia — the last of which OSM *does* map, as
Orocopia Mountain) or named points on a rim. They take Peakbagger provenance on
the scheme the Oregon and Colorado pass established: a `peakbagger:peak:<id>`
hash for the destination id, `{"peakbagger": "<id>"}` in `external_ids`, and
`source: 'peakbagger'` in the metadata. GNIS is used for nothing.

**No 3DEP summit search was needed this time.** The Oregon and Colorado pass had
to run one because its coordinates were quantised; these land on the summit
already. Of the 19 rows inside 3DEP's coverage, 18 read within 3.3 m of the
published elevation and 15 within 1 m.

## Reviewed overrides

Fourteen source rows reach their destination by reviewed override rather than by
name. Six point at rows the catalog already held, and eight at rows these
migrations add under the name OpenStreetMap uses.

**Existing rows.**

| List | Source row | Destination | Why |
|---|---|---|---|
| Desert Peaks | Weavers Needle (13418) | `8264B4AD714F0EA6E19E` Weaver's Needle | Same OSM node, 3 m apart. The matcher normalizes an apostrophe to a space, so "Weavers Needle" and "Weaver's Needle" do not compare equal |
| Desert Peaks | Glass Mountain (3614) | `WSfpljsS69KFXbCnDDcM` Glass Mountain | The catalog holds two rows of that name 1,049 m apart. The list point reads 3396.07 m in 3DEP against a published 3396.2 m; this row is 15 m from it, the other 1,049 m and 4 m lower |
| Tahoe Ogul | Middle Sister (3607) | `dQvlhlqanHJh4h4JSkP7` Middle Sister | Same OSM node, 1 m apart. The row's stored elevation was wrong, which is what kept the matcher off it; this pass corrects it |
| Tahoe Ogul | Sierra Buttes (13567) | `89lGAhqgSm18Jih8vRUk` Sierra Buttes Lookout | Same OSM node and the same summit, 7 m apart; the catalog names the row for the fire lookout standing on it |
| Tahoe Ogul | Adams Peak - West Peak (69023) | `D80BD9D570012B82ED80` Adams Peak | The catalog row sits 19 m from the point Peakbagger calls the West Peak, and carries the OSM node named Adams Peak. Adding a second row 19 m away would be a duplicate |
| South Beyond 6000 | Kuwohi (7764) | `fC9zpl4WpEUZvU4HTsSI` Clingmans Dome | The same override the Tennessee 4500ft list already carries |

**Rows these migrations add, under the OpenStreetMap name.**

| List | Source row | Destination name | Apart |
|---|---|---|---|
| Desert Peaks | Granite Mountain (3804) | Granite Peak | 16 m |
| Desert Peaks | Superstition Benchmark (4173) | Superstition Peak | 9 m |
| Desert Peaks | Indianhead (13412) | Indian Head Peak | 16 m |
| Desert Peaks | Orocopia Mountains High Point (16806) | Orocopia Mountain | 2 m |
| Tahoe Ogul | Silver Peak - Southwest Summit (53297) | Silver Peak | 17 m |
| Tahoe Ogul | Wade Benchmark (26373) | Wade Peak | 4 m |
| South Beyond 6000 | Mount Hallback (7823) | Hallback | 85 m |
| South Beyond 6000 | Plott Balsam Mountain (7830) | Plott Balsam | 3 m |

The Tahoe Ogul list carries a second, unrelated Silver Peak at 8,931.4 ft, 45 km
away and 559 m lower. It resolves by name on its own; the two cannot be confused
by the matcher, which bounds every match by elevation and distance.

## Catalog problems found on the way

One is fixed here. The rest are recorded and left.

- **Middle Sister in California stored Oregon's height, and that is corrected.**
  `dQvlhlqanHJh4h4JSkP7` sits in the Sweetwater Mountains at 38.50794 −119.29533
  and read 3062 m — exactly the figure the catalog's Oregon Middle Sister
  (`U0r2Ys42V3pk8j8Hqtje`) carries, and about 249 m low. The Tahoe Ogul list
  publishes 10,862.4 ft (3310.9 m) and the row's own OSM node 358798800 tags
  3306 m. It now reads 3310.9 m, PointZ included. Only the elevation was wrong:
  the two rows' prominences differ (260 m and 343 m) and the coordinates are
  each in the right state. The Oregon row is untouched, and an assertion checks
  that it did not move.
- **Two Glass Mountain rows describe one mountain.** `WSfpljsS69KFXbCnDDcM`
  (3402 m, OSM 12129062101) and `094BAF44DD547E83FF26` (3395 m, OSM 358797930,
  Wikidata Q3108557) stand 1,049 m apart on the same Mono County massif. 3DEP
  reads 3395.1 m at the first and 3390.8 m at the second. The Desert Peaks
  override takes the first; **the duplicate is not merged here**, because
  merging two catalog rows touches sessions, lists and routes and is its own
  piece of work.
- **Big Maria Mountains High Point's published elevation is 13 m above the
  ground.** Peakbagger gives 3,385 ft (1031.7 m); 3DEP reads 1018.3 m at the
  point, and a 9×9 grid at 50 m spacing around it finds nothing higher. The
  position is not in doubt — the grid maximum is the point itself. The published
  figure is stored, consistent with the other twenty rows in that migration, and
  the disagreement is recorded here rather than silently swapped for a reading
  that itself varied 1.7 m between two calls to the same service.
- **Reynolds Peak reads 19.7 m below its published elevation** at the stored
  point, the only OpenStreetMap row over 10 m out. Both candidate points read
  low there (2944.6 m at the OSM node, 2955.9 m at the Peakbagger point against
  a published 2975.6 m), so this is a peak whose true high point neither source
  quite reaches, not a wrong match: the two points are 25 m apart and the name
  is exact.
- **Two Mexican rows cannot be checked against 3DEP at all.** Cerro del Pinacate
  and Pico Risco lie outside its coverage; the elevation service answers there
  from a coarse global grid (its reported resolution switches from 1 m to a
  fraction of a degree), so neither row is counted as verified.
- **Martinez Mountain's OSM node sits 344 m from Peakbagger's point** — the
  widest disagreement in this pass. The identity is not in doubt: the names match
  exactly and the two elevations agree to 1.6 m. The row stores the Peakbagger
  point, which 3DEP puts 2.4 m higher.
- **The matcher cannot see through an apostrophe.** `normalizeListPeakName`
  turns every non-alphanumeric run into a space, so "Weaver's Needle" normalizes
  to `weaver s needle` and "Weavers Needle" to `weavers needle`. They do not
  compare equal, and an override was needed for a row that is otherwise a
  perfect match. Collapsing an apostrophe instead of spacing it would fix this
  class, and it is a change to the matcher rather than to this import.
- **62 of 91 OpenStreetMap `ele` tags on these peaks are contour values**, low
  by 4 to 153 m against the figure the source list publishes. This is the same
  finding the Northeast pass recorded on eight rows, at a much larger scale.

- **305 Wikidata items are shared by two or more destinations**, catalog-wide and
  almost all of it European: twelve German and Dutch hills carry Q1749655
  between them, five Polish crags carry Q7849064, and four rows named Schrode
  Lake share Q49310112. This came to light because the first draft of the new
  migrations asserted Wikidata uniqueness catalog-wide and the assertion fired
  on the existing data. The assertion was narrowed to what these migrations
  answer for — that no Wikidata ID **they write** reaches a second destination —
  and the 305 are written down here instead. **OSM node IDs are clean**: no node
  reaches two destinations, so that assertion stayed catalog-wide.
- **Twenty-one list members store an elevation more than 3 m from the figure
  their source list publishes, and none of them is a row this pass added.** The
  worst are Smith Mountain (`89B7405BBE33641A563A`, 1744 m stored against
  1807.0) and Old Dad Mountain (`44E0D7BDEDBF2536C88B`, 1256 m against 1296.7),
  both from the 2026-07-21 global coverage pass.
  Three members also sit over 200 m from their source point: Red Lake Peak
  295 m, Smith Mountain 210 m, Mount Sequoyah 202 m. All are exact name matches;
  the identities are not in doubt.
- **The eight list members with no `state_code` and no `country_code` are
  fixed**, in `20260821_western_list_state_codes.sql`. Seven are Desert Peaks
  members and one is on South Beyond 6000, all Firestore-era rows with empty
  `external_ids` that the import merely put on a list. Each state comes from the
  row's own coordinates, cross-checked against Peakbagger's own section column
  where the source list prints one, and the update only fires when the point
  falls inside that state's bounding box.

## The area-linking trigger degenerates on a batch spread across the map

Found while applying, and worth writing down because it will bite the next
multi-region import.

`link_areas_on_destination_insert` is a **statement** trigger. It takes the
envelope of every row in the statement, expands it by two degrees, and treats
every protected area touching that box as a candidate — then runs `ST_Covers`
and a 50 m geography `ST_DWithin` against each. These 91 rows run from a North
Carolina bald at −82° to the Sierra at −120°, so a single `INSERT` made the
candidate set **2,605 of the 3,869 areas** and the geometry work 91 × 2,605.
That statement ran **27 minutes without finishing**.

The migrations therefore insert **one two-degree tile at a time**. The worst tile
draws 434 areas against 16 rows and the batch's geometry work falls about
ninefold; the whole migration then applied in **242 seconds**. The rows, the
guards and the result are identical either way — only the statement boundaries
move.

The Northeast pass did not hit this because its seventeen rows were all in one
corner of the map. Nothing is changed in the trigger here; the fix belongs with
whoever next touches it, and the shape of it is clear enough — the candidate box
should be per row, or the batch should be tiled inside the trigger rather than
by every caller.

## Wikipedia backfill

Run per list after the import.

| List | Written | Images | Refused | Unmatched | Hero coverage after |
|---|---|---|---|---|---|
| Desert Peaks Section | 26 | 20 | 0 | 58 | 31 of 95 |
| Tahoe Ogul Peaks | 35 | 32 | 0 | 26 | 34 of 63 |
| South Beyond 6000 | 11 | 11 | 0 | 22 | 18 of 40 |
| Idaho 12ers | 6 | 2 | 0 | 1 | 4 of 9 |

Nothing was refused on licensing. The Desert Peaks list has the thinnest
coverage and the reason is plain in its unmatched list: Wikipedia has no
confident article for a range high point ("Turtle Mountains High Point",
"Palen Mountains High Point") or for the many desert summits that share a name
with a dozen others ("Granite Mountain", "Eagle Mountain", "Pinto Mountain").
The Idaho 12ers did best in proportion — eight of nine took copy — because every
one of them has an article.

## Verification

- **Dry run** resolved all seventeen curated lists with no unresolved row, and
  reported 0 added, 0 removed and 0 reordered for each of the thirteen already
  in Peaks.
- **Apply** reported 95, 63, 40 and 9 members added on the four new lists, and
  the same thirteen zeroes.
- Production holds **29 lists**, and every one of them — not just the four new
  ones — numbers 0 through n−1 with no gap and no repeat.
- **112 new destinations** are present, 91 with OpenStreetMap provenance and 21
  with Peakbagger provenance. All 112 carry a prominence from the source list.
  Every one carries a PointZ equal to its elevation, the `summit` feature, owner
  `peaks` and a country. 95 of them picked up protected-area links from the
  insert trigger, 151 links in all.
- **All 207 stored members were checked against their source row in source
  order** — 95 + 63 + 40 + 9, name by name. The three that sit over 200 m from
  their source point and the twenty-one over 3 m from its elevation are all
  pre-existing rows, listed above.
- The Tahoe Ogul split came out **56 California and 7 Nevada** from the stored
  rows, matching tahoeogul.org exactly. The Desert Peaks list stores **64
  California, 17 Nevada, 9 Arizona, 3 Mexico and 2 Utah**, against the source
  page's own section headings of 66 / 15 / 9 / 3 / 2 — the two differ on two
  border peaks that Peakbagger files under a California county and
  OpenStreetMap's boundaries put in Nevada. South Beyond 6000 stores **34 North
  Carolina and 6 Tennessee**; the club says all forty are in North Carolina or
  on its Tennessee line except Mount Le Conte, and the six are Le Conte plus
  five Smokies and Roan crest peaks sitting on that line.
- **Middle Sister in California reads 3310.9 m with a matching PointZ**, and the
  Oregon row still reads 3062 m.
- **All three migrations are idempotent.** A second run of each wrote nothing —
  `UPDATE 0`, no insert — and every assertion still passed.
- **The assertions were tested by injecting corruption** inside a transaction
  and rolling back. A deleted row, stripped provenance, a row that stops being a
  summit, a row that loses its country, an OSM node ID handed to a second
  destination, a Wikidata ID handed to a second destination, Middle Sister put
  back to 3062, and a missing Peakbagger-only row each raised the exception
  meant for it. Two more — an elevation moved away from its PointZ, and a
  cleared location — never reach the assertion at all: the schema's own
  `destinations_elevation_matches_location_z` CHECK refuses them first, which is
  the stronger guarantee.
- `cd cloud-sql/migrate && npm test`: 688 pass, 0 fail, 8 skipped. `tsc` clean.

No source page needed a login and none served a CAPTCHA.

This work adds no service, job, or steady compute cost. Monthly cost impact: $0.
