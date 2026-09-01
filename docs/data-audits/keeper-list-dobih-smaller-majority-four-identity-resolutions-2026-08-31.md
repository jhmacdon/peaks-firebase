# Smaller DoBIH Majority-Four Identity Resolutions — 2026-08-31

## Status

The checked fixture resolves all 648 source identities and 678 list
memberships. No row remains open or refused. This change only prepares data. It
does not add an import or apply command, connect to production, create routes,
queue covers, or publish a list.

The four lists remain unpublished. Destination-cover, safe-route, and
route-cover review still must pass. The four firing-range blocks also remain in
force.

This change adds no service, timer, job, or running resource. Run-rate change:
**$0/month**.

## Pinned inputs and output

| Input | SHA-256 |
| --- | --- |
| Smaller majority-four source fixture | `4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b` |
| Prior identity analysis | `4862036f5fe1149c496af9f4c99af0ab213b02fbcf494307794dfe55fef940f3` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Read-only catalog snapshot | `b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab` |
| Cruim Leacainn OSM evidence | `ddc8e187ae032bc6da89dea02b2ecb8e87940d2d890550eb59c4d2cf5912fd59` |
| Checked resolution fixture | `d979dc4b98cdfcc85f7a18a5621bba389fda6f8e37d27036affa06d571f017a9` |

DoBIH v18.5 is CC BY 4.0. The compact Cruim Leacainn evidence pins
[OpenStreetMap node 2781920981](https://www.openstreetmap.org/node/2781920981)
under ODbL 1.0. The builder checks every byte before it makes the fixture.

## Exact decisions

The 359 rows left open by the first analysis now have these outcomes:

| Outcome | Open rows | Full 648 identities |
| --- | ---: | ---: |
| Existing catalog destination | 10 | 290 |
| Catalog repair | 2 | 3 |
| New deterministic curated destination | 347 | 355 |
| Refused or unresolved | 0 | 0 |

The full totals include the 121 prior reviewed identities. The third catalog
repair is the prior High Street decision. Every list projection keeps one
destination for each shared source identity. The fixture has 648 unique
destination IDs.

The three direct repairs live on their source rows as
`resolution: catalog_repair`, as the shared core schema requires. The fixture's
top-level `catalogRepairs` array is empty because that array is only for
auxiliary catalog repairs not owned by one source row.

## Eleven close catalog cases

The audit found eleven catalog points within 150 metres of an open row. Ten are
the same summit after exact point, height, and name review. Yockenthwaite Moor
needs a country-only repair.

| DoBIH source | Catalog destination | Distance | Height difference | Decision |
| --- | --- | ---: | ---: | --- |
| `886` Sgurr Fhuar-thuill | `52DE809AB1BA1A592906` Sgurr Fuar-thuill | 3 m | 0.993 m | Reuse spelling variant |
| `1004` An Teallach - Sgurr Fiona | `1F047C2D57CC6FA5E79B` Sgurr Fiona | 5 m | 1.3 m | Reuse short name |
| `2013` Creigiau Gleision | `315C82D37714B3D4D7C9` Creigau Gleision | 5 m | 2.1 m | Reuse spelling variant |
| `2098` Pen y Brynnfforchog | `A186D7949B1DE027F673` Pen y Brynfforchog | 5 m | 0.2 m | Reuse spelling variant |
| `2117` Cefn Dylif | `F13F112E0E1FFEB3F6A2` Pen Bwlch Llandrillo | 4 m | 2.5 m | Reuse exact DoBIH alias |
| `2137` Cadair Idris - Penygadair | `924E1424345A32DABFC1` Cadair Idris | 3 m | 0.3 m | Reuse short name |
| `2145` Maesglase | `A8CB50D94959D5EA2784` Maesglase (Craig Rhiw-erch) | 2 m | 0.5 m | Reuse qualified name |
| `2178` Great Rhos | `50D6E65DF0B624FBE4B8` Rhos Fawr | 14 m | 0 m | Reuse English/Welsh name |
| `2236` Bannau Sir Gaer - Picws Du | `87F6450C01D7CE41F0F9` Picws Du | 2 m | 0.1 m | Reuse short name |
| `2242` Black Mountain | `B1136F356AA244BF4B52` Twyn Llech | 30 m | 0.039 m | Reuse alternate name |
| `2791` Yockenthwaite Moor | `5Fmpn5fM3oxvOEYhwErB` Yockenthwaite Moor | 7 m | 0 m | Keep point; set country to `GB` |

The Yockenthwaite before and after fingerprints keep the catalog name, 643 m
height, `54.225506, -2.140927` point, and empty external-ID set. Only the
missing country changes from `null` to `GB`.

## Cruim Leacainn repair

Catalog destination `D32B52D720CF6A0BD155` starts at 232 m and
`56.8795609, -5.0137955`. It owns the only catalog use of OSM node
`2781920981`. DoBIH Number 344 puts the surveyed summit at 231.1 m and
`56.88175, -5.010484`, 316 metres away. Its source row says the summit is a
knoll 300 metres northeast of the trig point and that the trig point is about
2.5 metres lower.

The repair moves the same mountain identity to the DoBIH point. It pins the old
OSM owner, then removes node `2781920981` because that coordinate-bound node
still marks the lower point. The new fingerprint has no OSM ID. The repair
keeps `GB` country and pins the exact external-ID removal. The builder rejects
a different name, height, point, distance, OSM node, owner, or source note.

## Distinct summits

Five names needed an explicit semantic check even though their catalog
neighbors lie outside the 150-metre duplicate bound:

- `dobih:2017` Ysgafell Wen North Top stays apart from Ysgafell Wen, 540 m
  away. DoBIH 2016 pins the main summit.
- `dobih:2377` Black Crag stays apart from Scoat Fell, 710 m away, and Steeple,
  846 m away. DoBIH 2373 and 2379 pin those two summits.
- `dobih:2415` Whiteside East Top is a new 719.4 m summit, apart from the
  703.3 m Gasgale Crags point and the 707 m Whiteside point. DoBIH 3732 and
  2418 pin the lower points.
- `dobih:2446` Seathwaite Fell (Great Slack summit) is a new 631 m summit,
  apart from the 601.1 m Wainwright summit. DoBIH 2448 and 2456 pin the nearby
  Seathwaite Fell tops.
- `dobih:5603` Fan Brycheiniog - Twr y Fan Foel stays apart from the old
  Fan Brycheiniog trig-point top, 289 m away. DoBIH 2230 says the new cairn is
  0.75 m higher.

Each row has fixed `distinctFromDestinationIds`, source links, and support-row
links. The other 342 new curated rows have no catalog summit or accepted
destination within 150 metres. The four-list source set also has no source pair
inside that bound.

## Bounds and route blocks

Every accepted destination has country `GB`, a null state, a height from 0 to
1,500 metres, latitude from 49 to 61, and longitude from -11 to 3. The builder
checks the 347 new curated destinations against all 2,524 catalog summits, all
other accepted destinations, and each other. It also checks all four list
projections with the shared resolution contract.

The route blocks now map to exact destination IDs:

| DoBIH source | Destination ID | Block |
| --- | --- | --- |
| `2711` Mickle Fell | `B809DFD0EEF01F50F412` | Warcop live firing; route publication false |
| `2713` Little Fell | `7676D95B0EE8387FA98D` | Warcop live firing; route publication false |
| `2735` Murton Fell | `FF8081D94BDB52C88692` | Warcop live firing; route publication false |
| `2877` High Willhays | `F0ED9939484E003F7E5C` | Dartmoor firing/access notice; route publication false |

Identity review does not clear those blocks.

## Rebuild

With the pinned DoBIH CSV and catalog snapshot present, run:

```sh
npm run build:keeper-list-resolutions:dobih-smaller-majority-four
```

This command only rebuilds the checked JSON file. The package has no import or
apply command for these four lists.
