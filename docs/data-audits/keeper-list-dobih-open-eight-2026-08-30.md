# DoBIH Open Eight Keeper List Audit — 2026-08-30

## Status

This change prepares eight reviewed list rosters and a fail-closed importer. It has not imported them. The production check used a read-only transaction and did not pass `--apply`. Merges and the production import still need Josiah's approval.

The change adds no service, timer, job, or other running resource. Run-rate change: **$0/month**.

## Pinned inputs

| Input | SHA-256 |
| --- | --- |
| DoBIH v18.5 archive | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Open-eight candidate fixture | `3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae` |
| Base resolution fixture | `326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77` |
| Read-only production catalog, 2,505 rows | `ba9eafe8f7a97f1b96a95c4b0c4a2fc6818f575da9425c1b57dd19467c319726` |
| First unresolved analysis, 681 identities | `77aeff4d1c11c0202568c351bc578a6437e85219808540aedbf60e01a9b2c502` |
| Nearby OSM evidence | `1c1f8f128949bf0f400498567df2d8320dced0f6f83d2d8d8f882ee2dbbf6c8e` |
| Nearest OSM evidence | `49a13a228df0e9658f9d9e76e98ab849ccfdfea170ab0cfaf170ef7b03dac3d4` |
| Final resolution fixture | `bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1` |
| Canonical final resolution data | `c8603cb6db054c93799094e65cd0ac00225b06b628d1d3e72eb2c351ff23ffbf` |

The fixture builder accepts one exact source typo: raw DoBIH row 20085 must be `Meenteog [Moing an tSamhaidh]]`. It emits name `Meenteog` and alias `Moing an tSamhaidh`. It rejects a changed row 20085 value and every other unbalanced bracket.

## Exact rosters

| List | Count | Roster SHA-256 |
| --- | ---: | --- |
| Munro Tops | 226 | `160fd59e3b4409919a7b5e70bfed265fa70a9bc62feb9743ae754ce198a5c65f` |
| Furths | 34 | `020e054ab78d24151f4c16169acd847e63d6a6867d792b98148906ac2b3fae1d` |
| Donalds and Donald Tops | 141 | `a64c6bba2e79621fa08004bb28d1721259b0cd1f6dc0f7685935cb9b6290bfae` |
| Wainwright's Outlying Fells | 116 | `5ffd1ed3e76a350203a27d57ded8f7b7ac354c0443547f63cb8a788cd30f4999` |
| Fellrangers | 230 | `f72a4325df13c1e3e4b5f3046b297e558e900441cad6a44637b017e9988d11c8` |
| Vandeleur-Lynams | 275 | `c02ccde9dc1094bdc54262c0d336cff34805abbb2d6552d213cf45f8ebf4eee7` |
| Irish 2000-Foot Mountains | 207 | `cca6ca4c0a1a901b5038cc9cb1a7d80f759d42a0136b863a5e94542cf78bcbf4` |
| Grahams | 231 | `57e27078f2ec8a323cc34521210d707eba817e3baf8297fa6dbb6971b0c298be` |

The eight rosters contain 1,460 memberships and 1,201 source identities. They share 212 identities with the checked Corbetts and Wainwrights rosters and add 989 identities after those two lists.

Irish County Highpoints stays out of scope. Its roster includes non-summit highpoints that the current destination model cannot represent well.

## Identity review

The final resolution file has 827 owner rows for 683 source identities:

- 76 `existing_destination` rows;
- 6 `catalog_repair` rows;
- 745 `curated_destination` rows;
- 11 separate catalog name or external-ID repairs.

The other 518 source identities, covering 633 memberships, use bounded catalog matching. A runtime guard now requires any repeated source identity to reach the same destination in every list, including automatic matches.

The file reuses 45 identities from the base review: 33 existing destinations, 10 curated destinations, and 2 direct repairs. It also keeps all 7 base catalog cleanups. The new work pins 27 existing identities across 43 owner rows. Graystones (`dobih:3713`) is explicit because the base cleanup renames its catalog row to `Graystones (main summit)` before list matching; its checked destination is `E9144D2AE04F27E48524`.

The four new direct repairs are:

| Source | Destination | Point move | Elevation change |
| --- | --- | ---: | ---: |
| `dobih:99` Mid Hill | `CE9EAA9D73E23237966E` | 129 m | 0.1 m |
| `dobih:681` Creag Ruadh | `2FF8B47F8C691BD20358` | 55 m | 0.2 m |
| `dobih:786` Druim Fada | `E430C7936F66347EBAFE` | 273 m | 1.1 m |
| `dobih:996` Beinn na Feusaige | `8426AC54741E8DE5F686` | 643 m | 1.8 m |

Validation rejects a direct repair over 750 metres or an elevation change over 10 metres. It also rejects two direct repairs aimed at one destination and any direct repair that collides with a separate catalog cleanup before the first query.

Four close catalog rows are separate tops, not bad main-summit records. The review creates the main summits for `dobih:1693`, `dobih:722`, `dobih:725`, and `dobih:756`, then renames the nearby catalog rows to Meikle Millyea Trig Point, Beinn a' Chapuill West Top, Beinn Clachach West Top, and Meall nan Eun West Top. Their reviewed support distances are 12, 50, 14, and 127 metres. Only the Meikle Millyea cleanup removes stale Wikidata ID `Q86753760`.

Fifteen curated source rows carry exact close-neighbor guards: the 14 reviewed new rows plus the reverse guard from `dobih:1005` to the new `dobih:1006` destination. No resolution or repair writes a DoBIH number into destination external IDs.

## Ireland and the border

DoBIH `Country=I` covers the whole island. A County value containing Causeway Coast and Glens, Derry City and Strabane, Fermanagh and Omagh, or Newry, Mourne and Down maps to `GB`; other Irish rows map to `IE`. This yields 23 Northern Ireland source identities. Fourteen need explicit resolution rows.

The checked combined County values include Meenard Mountain (`dobih:20200`) and Cuilcagh (`dobih:20137`). Cuilcagh keeps its bounded automatic match to GB destination `E1B5FA84B5B6986A16FF`, OSM node `3133612029`, 26 metres from the source point. DoBIH `Country=ES` means the England/Scotland border and maps to `GB`.

## High Knott access rule

Peaks does not yet support an optional list membership. The Outlying Fells list therefore includes all 116 source rows and says that Peaks counts all 116. It also warns that the LDWA permits High Knott, also called Williamson's Monument, to be omitted because access is prohibited.

The planned High Knott identity is `dobih:2630`, destination `7F036923996DFDBB0C0C`. A production read-only query saved at `/private/tmp/high-knott-route-proof-2026-08-30.json` returned:

```json
{"allRouteCount": 0, "destinationId": "7F036923996DFDBB0C0C", "activeRouteCount": 0, "destinationExists": false}
```

That proof has SHA-256 `6b505e97cd17d5f8068fdd365d1979bcb0612c247370915a26e5aec2ba41a743`. Do not publish a route to this destination. If product progress must match the keeper waiver, add optional-membership support first.

## Production read-only proof

The exact no-apply report is `/private/tmp/dobih-open-eight-dry-run-2026-08-30.json`, SHA-256 `688e25b20ddc5d9916965d4cd2dc8d2bc69f000a0ab2f2bf10485bbc4e375fed`.

- `apply=false` and `complete=true`;
- all eight lists appear in definition order;
- resolved counts are 226, 34, 141, 116, 230, 275, 207, and 231;
- every unresolved count is zero;
- the current pre-base state plans 617 unique destination additions and 17 unique repairs;
- a local post-base simulation plans 607 additions and 8 repairs;
- a second local plan with all 1,460 memberships, additions, and repairs in place reports no additions, repairs, membership changes, or order changes.

The report records intended changes only. No production row was written.
