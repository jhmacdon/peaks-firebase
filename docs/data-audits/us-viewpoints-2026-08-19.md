# United States viewpoint coverage — 2026-08-19

## Scope

This follow-up covers the 49 states outside Washington. Each source snapshot
contains named OSM `tourism=viewpoint` nodes, ways, and relations for one state.
The snapshots span `2026-05-31T22:37:44Z` through
`2026-08-20T00:43:28Z` across the available Overpass mirrors.

The three review lanes covered all 6,220 parser-valid candidates:

- 5,285 included
- 551 excluded as road or access ends, private or closed places, unrelated
  attractions, false viewpoint tags, or duplicate border rows
- 384 held because the name, access, state, or viewpoint identity needs more
  proof

The importer parser removed four private or closed source rows before review.
A cross-state identity check found four Kentucky border-query duplicates. The
two `Caution` signs belong to Indiana and remain excluded there. River Overlook
and Carew Tower belong to Ohio and are included only there.

This pass imports reviewed named viewpoints only. It does not invent names for
unnamed OSM points. Those need direct hiking-source review like the Washington
Mount Si, Mount Storm King, and Mount St. Helens supplements.

## Reviewed result

The live dry-run planned:

- 5,247 new destinations
- 38 exact existing-destination enrichments
- 0 unclear destination matches
- 0 elevation gaps
- 27 new links to ended sessions with a saved path and a nearby real point

The import changes destination data only. It does not change iOS route labels or
how the app treats a route end as its top or turnaround.

## Applied result — 2026-08-20

The guarded import applied all 49 state plans:

- 5,247 destinations inserted
- 38 exact existing destinations enriched with the `viewpoint` feature
- 27 new session links made by the normal destination trigger
- 0 unclear matches and 0 elevation gaps

The live United States catalog now has 5,651 viewpoint destinations across 49
states and 149 viewpoint-session links. That link total includes the 115 links
already counted in Washington, the 27 new links, and 7 old links on destinations
that this pass enriched.

A fresh 49-state dry-run resolved all 5,285 included rows as unchanged. It found
0 pending inserts, enrichments, session links, unclear matches, or elevation
gaps.

| State | Candidates | Included | Excluded | Held | Inserts | Enrichments | Links |
|---|---:|---:|---:|---:|---:|---:|---:|
| AK | 4 | 3 | 0 | 1 | 3 | 0 | 0 |
| AL | 49 | 44 | 3 | 2 | 44 | 0 | 0 |
| AR | 64 | 63 | 1 | 0 | 63 | 0 | 0 |
| AZ | 255 | 220 | 17 | 18 | 220 | 0 | 1 |
| CA | 898 | 725 | 101 | 72 | 716 | 9 | 0 |
| CO | 115 | 108 | 4 | 3 | 108 | 0 | 0 |
| CT | 37 | 35 | 2 | 0 | 34 | 1 | 0 |
| DE | 3 | 2 | 0 | 1 | 2 | 0 | 0 |
| FL | 103 | 91 | 4 | 8 | 91 | 0 | 0 |
| GA | 83 | 68 | 9 | 6 | 66 | 2 | 0 |
| HI | 132 | 89 | 28 | 15 | 89 | 0 | 0 |
| IA | 7 | 6 | 1 | 0 | 6 | 0 | 0 |
| ID | 13 | 7 | 1 | 5 | 7 | 0 | 0 |
| IL | 125 | 110 | 15 | 0 | 110 | 0 | 0 |
| IN | 52 | 33 | 18 | 1 | 33 | 0 | 0 |
| KS | 23 | 18 | 5 | 0 | 18 | 0 | 0 |
| KY | 89 | 78 | 10 | 1 | 77 | 1 | 0 |
| LA | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| MA | 178 | 144 | 15 | 19 | 144 | 0 | 0 |
| MD | 98 | 90 | 6 | 2 | 90 | 0 | 0 |
| ME | 78 | 73 | 1 | 4 | 73 | 0 | 0 |
| MI | 189 | 176 | 13 | 0 | 175 | 1 | 0 |
| MN | 168 | 137 | 30 | 1 | 136 | 1 | 0 |
| MO | 67 | 49 | 18 | 0 | 49 | 0 | 0 |
| MS | 11 | 10 | 1 | 0 | 10 | 0 | 0 |
| MT | 59 | 45 | 10 | 4 | 44 | 1 | 0 |
| NC | 274 | 267 | 1 | 6 | 266 | 1 | 3 |
| ND | 14 | 14 | 0 | 0 | 14 | 0 | 0 |
| NE | 38 | 19 | 18 | 1 | 19 | 0 | 0 |
| NH | 98 | 93 | 1 | 4 | 92 | 1 | 12 |
| NJ | 114 | 100 | 11 | 3 | 99 | 1 | 0 |
| NM | 155 | 101 | 24 | 30 | 101 | 0 | 0 |
| NV | 87 | 56 | 16 | 15 | 55 | 1 | 0 |
| NY | 510 | 467 | 13 | 30 | 458 | 9 | 3 |
| OH | 131 | 113 | 17 | 1 | 113 | 0 | 0 |
| OK | 27 | 26 | 0 | 1 | 26 | 0 | 0 |
| OR | 222 | 198 | 15 | 9 | 195 | 3 | 1 |
| PA | 273 | 252 | 7 | 14 | 250 | 2 | 0 |
| RI | 9 | 9 | 0 | 0 | 8 | 1 | 0 |
| SC | 28 | 24 | 1 | 3 | 23 | 1 | 0 |
| SD | 46 | 42 | 3 | 1 | 42 | 0 | 0 |
| TN | 185 | 166 | 11 | 8 | 166 | 0 | 1 |
| TX | 119 | 101 | 18 | 0 | 101 | 0 | 0 |
| UT | 470 | 406 | 13 | 51 | 406 | 0 | 6 |
| VA | 275 | 229 | 19 | 27 | 229 | 0 | 0 |
| VT | 122 | 88 | 33 | 1 | 86 | 2 | 0 |
| WI | 35 | 32 | 3 | 0 | 32 | 0 | 0 |
| WV | 68 | 53 | 2 | 13 | 53 | 0 | 0 |
| WY | 16 | 5 | 8 | 3 | 5 | 0 | 0 |

## Review record

- Per-state preview summary SHA-256: `d3f098767f3c91cd03d621866ff6a06c45344daaeb91c85dd0a0e23b7668ac05`
- Central review summary SHA-256: `d740ddacd2ff7bb90ec869d5052583f985f29849a195143832f19c4b06783457`
- East review summary SHA-256: `075e595c220df8c085f06b64b4113cf4923d30585c305da69ea5980520c7d5e0`
- West review summary SHA-256: `a7cbcec656a10892a7839b63d8ec10462bf2854116ca8a42234ea48ad8fe2a26`
- Applied result receipts SHA-256: `db5666c53b88640409171c7c31fd8d5a09a4f8afa4d74461dc7c611bc8def413`
- Post-import preview summary SHA-256: `15bbb12f61a888e28d92977d07fc900e5f329972bed856bcc3e67231aa5bb22a`

The script adds no service, schedule, or always-on process. Monthly
infrastructure cost stays at `$0`.
