# DoBIH RHSoc four source audit — 2026-09-01

## Status

This change freezes four source rosters. It does not add an importer, resolve
the 2,754 new identities, create routes, queue covers, or write production
data. Publication readiness stays `false`. Each list must stay unpublished
until every identity, destination cover, safe route, and route cover passes
review.

The four rosters raise the dated ready stack from 45 to 49 exact units out of
83. Production stays at 22 of 83. This work adds no running resource. Run-rate
change: **$0/month**.

## Pinned open source

| Input | Bytes or rows | SHA-256 |
| --- | ---: | --- |
| DoBIH v18.5 archive | 2,342,737 bytes | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | 13,396,947 bytes / 21,576 rows | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | — | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Four-list fixture | 1,499,794 bytes | `cb75b57dc26431565b592f11e7c96f218cda090841fc258628e24f5753347005` |

[DoBIH v18.5](https://www.hill-bagging.co.uk/dobih/downloads/) was
released on 2026-07-26 under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The direct archive is
`https://www.hill-bagging.co.uk/dobih-downloads/hillcsv.zip`. The builder
rejects other CSV bytes or source-license records.

The [Relative Hills Society registers](https://www.pedantic.rhb.org.uk/index.php/registers)
keep all four completion registers. The
[Marilyn Hall of Fame](https://www.pedantic.rhb.org.uk/index.php/registers/43-registers/886-marilyn-hall-of-fame)
states the current 1,550-member count. The
[High Hills book](https://www.pedantic.rhb.org.uk/books/5) keeps 1,033 in its
title, while the live register and DoBIH v18.5 contain 1,035. That is one
versioned list, not two denominator units.

The keeper site did not yield a fresh stable page capture during this audit.
This change therefore claims no keeper-page byte hash. The exact reusable
rosters come from the pinned DoBIH archive.

## Exact rosters

| Registry unit | Source key | Rule | Rows | List ID | Ordered roster SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| Great Britain Marilyns | `dobih-great-britain-marilyns` | `Ma=1 AND Country IN (E,ES,S,W)` | 1,550 | `28159A46DB14A20C6AAD` | `055fe69b5a5ad8dc78445fdbc0051e9c062b813f777983d843a844b9943eddbd` |
| High Hills of Britain | `dobih-high-hills-of-britain` | `HHB=1` | 1,035 | `07F30062B5F3654C3493` | `66f5919cddefae958d02337610c0e0218543ebd7cb261a909b98286d004b52e0` |
| Simms | `dobih-simms` | `Sim=1` | 2,755 | `71F41F9E96DDD5D0FF02` | `59be2fd9017be3ec6f4284a5e2884f5ad05f77eced5ab53e1b83b1e1139b7a87` |
| Subsimms | `dobih-subsimms` | `sSim=1` | 739 | `8C5F5BC5DC2D8F765ACB` | `241812f1e490c6521c34dc0bdee310ed3a4eede95a941889d05c793221237c96` |

Rows sort by DoBIH Number and keep contiguous source ordinals. The lists have
6,079 memberships and 4,306 unique source identities. Of those identities,
2,875 occur in one list, 1,089 in two, and 342 in three. None occurs in all
four.

| Pair | Shared identities |
| --- | ---: |
| Marilyns / High Hills | 342 |
| Marilyns / Simms | 767 |
| Marilyns / Subsimms | 0 |
| High Hills / Simms | 828 |
| High Hills / Subsimms | 178 |
| Simms / Subsimms | 0 |

Against the checked Corbetts, Wainwrights, open-eight, smaller-four, Deweys,
Birketts, and Synges fixtures, 1,552 unique identities have prior source review
and 2,754 are new. The prior row counts are 667 Marilyns, 401 High Hills, 1,313
Simms, and 131 Subsimms.

The union has 290 alias-bearing identities and 227 repeated primary-name
groups covering 722 identities. It has no exact coordinate duplicates. The
shared parser keeps two named source corrections: DoBIH `1124` becomes
`Foinaven - Ganu Mor` with alias `Foinne Bhein`, and DoBIH `20085` becomes
`Meenteog` with alias `Moing an tSamhaidh`. Both reject changed raw source
text.

## Route blocks

Route safety audit complete: `false`. This first block set is non-exhaustive.
Absence from it never means that a source member or proposed route is safe.
Every route still needs a separate safety and access review.

These exact roster members remain blocked from summit-route publication:

| Source member | Exact source name | Block reason | List ordinals | Safety or access source |
| --- | --- | --- | --- | --- |
| `dobih:79` | The Cobbler | Exposed summit scramble | Marilyns 61; High Hills 34; Simms 57 | [Walkhighlands Cobbler route](https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml) |
| `dobih:1212` | Stac Pollaidh | Expert summit scramble | Marilyns 710; Simms 825 | [Walkhighlands Stac Pollaidh route](https://www.walkhighlands.co.uk/ullapool/stacpollaidh.shtml) |
| `dobih:1240` | Sgurr Dearg - Inaccessible Pinnacle | Rock climb and abseil required | Marilyns 734; High Hills 655; Simms 830 | [Walkhighlands Inaccessible Pinnacle profile](https://www.walkhighlands.co.uk/munros/inaccessible-pinnacle) |
| `dobih:1260` | Bhasteir Tooth | Technical climbing required | High Hills 673; Subsimms 82 | [British Mountaineering Council Cuillin guide](https://www.thebmc.co.uk/en/how-to-scramble-the-cuillin-ridge) |
| `dobih:1639` | Stac an Armin | Restricted sea-stack access | Marilyns 1,068 | [Mountaineering Scotland St Kilda account](https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf) |
| `dobih:1641` | Stac Lee | Restricted sea-stack access | Marilyns 1,070 | [Mountaineering Scotland St Kilda account](https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf) |
| `dobih:2711` | Mickle Fell | Live firing range | Marilyns 1,434; Simms 1,340 | [Warcop firing times](https://www.gov.uk/government/publications/warcop-firing-times) |
| `dobih:2713` | Little Fell | Live firing range | Simms 1,342 | [Warcop firing times](https://www.gov.uk/government/publications/warcop-firing-times) |
| `dobih:2735` | Murton Fell | Live firing range | Simms 1,356 | [Warcop firing times](https://www.gov.uk/government/publications/warcop-firing-times) |
| `dobih:2877` | High Willhays | Live firing range | Marilyns 1,510; Simms 1,399 | [Dartmoor access](https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access) |
| `dobih:2952` | The Cobbler South Peak | Rock climb required | High Hills 767; Subsimms 168 | [Walkhighlands Cobbler route](https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml) |
| `dobih:7888` | Sgurr nan Gillean Third Pinnacle | Rock climb and abseil required | High Hills 1,010; Subsimms 610 | [UKHillwalking Cuillin Ridge account](https://www.ukhillwalking.com/gear/competitions/who_won_the_race_along_the_cuillin_ridge-4738) |
| `dobih:19843` | Douglas Boulder | Rock climb required | High Hills 1,035 | [Rockfax Ben Nevis guide](https://rockfax.digital/crag/ben-nevis-1434) |
| `dobih:21237` | Hag's Tooth | Exposed Grade 2 scramble | Subsimms 735 | [Kerry Climbing scrambling page](https://kerryclimbing.ie/activities/scrambling/) |

Kerry Climbing names Stumpa an tSaimh (Hags Tooth) Ridge as Grade II. It
describes a steep, airy, jagged ridge with sheer drops that calls for scrambling
skill. That evidence supports a fail-closed publication block, not a default
summit route.

Each block has `routePublicationAllowed:false` and exact source occurrences.
Pillar Rock `dobih:2390` and High Knott `dobih:2630` occur in none of these
rosters. Named completion exceptions remain empty. These blocks do not create a
completion waiver.

## No import path

This change adds one fixture command. It adds no resolution builder, importer,
apply flag, or production write. A later import needs a separate reviewed
change after all 4,306 identities and all unblocked cover and route gaps pass
the zero-gap checks.
