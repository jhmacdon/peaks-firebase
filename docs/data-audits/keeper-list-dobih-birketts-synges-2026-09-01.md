# DoBIH Birketts and Synges source audit — 2026-09-01

## Status

This change freezes the Birketts and Synges source rosters. It does not add an
importer, resolve the 400 new identities, create routes, queue covers, or write
production data. Publication readiness stays `false`. Both lists must stay
unpublished until each identity, destination cover, safe route, and route cover
passes review.

The two rosters raise the dated ready stack from 43 to 45 exact units out of
83. Production stays at 22 of 83. This work adds no running resource. Run-rate
change: **$0/month**.

## Pinned open source

| Input | SHA-256 |
| --- | --- |
| DoBIH v18.5 archive | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Birketts and Synges fixture | `7400d0c105e469e4f0791a47bfa870aae5b8b7b18991c4bb4f97b7e95c33f6b5` |

[DoBIH v18.5](https://www.hill-bagging.co.uk/dobih/downloads/) was
released on 2026-07-26 under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The builder rejects other CSV bytes or source-license records.

[LDWA Hillwalkers Register 2](https://ldwa.org.uk/hillwalkers/register2.php)
keeps both completion registers. It states 541 Birketts and 670 current Synges,
and points walkers to DoBIH for current roster data.

## Exact rosters

| Registry unit | Source key | Rule | Rows | List ID | Ordered roster SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| Birketts | `dobih-birketts` | `B=1` | 541 | `045A11A6033DC6178CD2` | `970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7` |
| Synges | `dobih-synges` | `Sy=1` | 670 | `C28C4F0D933C73F79AC4` | `8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff` |

Rows sort by DoBIH Number and keep contiguous source ordinals. All 1,211
memberships are in England. The lists share 488 members and contain 723 unique
source identities.

Against the exact Corbetts, Wainwrights, open-eight, smaller-four, and Deweys
fixtures, 323 unique identities have prior source review and 400 are new. The
Birketts reuse 302 reviewed rows and add 239. The Synges reuse 322 reviewed rows
and add 348; many of those overlap the Birketts.

Identity review must use DoBIH Number, coordinates, elevation, and ordinal.
The union has 79 alias-bearing rows, 19 repeated primary-name groups covering
41 rows, and six distinct source pairs within 150 metres. Name-only matching or
nearest-point matching can merge distinct listed summits.

## Pillar Rock

DoBIH `2390`, Pillar Rock, is Birkett ordinal 61 and Synge ordinal 65. The LDWA
calls it an exposed rock climb, not a scramble. It accepts a Birkett claim after
the other 540 members and a Synge claim after the other 669 members.

The bundle keeps Pillar Rock in both exact rosters and pins one shared
`technical_rock_summit` publication block. A route to its summit must not
publish. A plain numeric completion target is not enough because it would let
someone omit any member. Production needs a named-member exception before
either list can import.

## No import path

This change adds one fixture command. It adds no resolution builder, importer,
apply flag, or production write. A later import needs a separate reviewed
change after all 723 identities and all unblocked cover and route gaps pass the
zero-gap checks.
