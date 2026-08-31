# Korea Forest Service 100 Famous Mountains audit

Status: ready for review, not imported. No command in this work used `--apply`.

## Result

- Keeper list: Korea Forest Service 100 Famous Mountains
- Product source key: `kfs-100-famous-mountains`
- Product list ID: `39F59B1A26E9B0818EBE`
- Official members: 100
- Reviewed destination decisions: 100
- Existing Peaks destinations: 38
- New reviewed destinations: 62
- Catalog repairs: 0
- Unresolved identities: 0
- KFS-to-KFS reviewed point pairs within 150 metres: 0
- Run-rate change: `$0/month`

The checked coordinate crosswalk is the exact route join. Route work must join `destination.destinationId` to `mntnId` in that file. It must not join Korean names, English names, or heights on their own. The importer does not write KFS member IDs into `destinations.external_ids`.

## Official roster

The [KFS 100 Famous Mountains page](https://www.forest.go.kr/kfsweb/kfi/kfs/foreston/main/contents/FmmntSrch/selectFmmntSrchList.do?mn=AR02_02_05_01&orgId=fon&mntIndex=1&mntUnit=100) provides one stable eight-digit `mntnId` for every member. The official workbook says `2022.1.1. 기준` and has 100 numbered rows. The review joined all 100 workbook rows to all 100 live page records by normalized base name and exact height.

The current [KFS mountain-information record](https://www.data.go.kr/data/15058662/openapi.do) covers the 100 Famous Mountains data and says it has no use restriction. The checked rights record pins that page's bytes, title, provider, modified date, 100 Famous Mountains coverage text, and exact license field. This audit uses bare roster facts. It does not treat KFS page or e-book images as reusable media.

| Source | SHA-256 |
| --- | --- |
| Official ZIP | `0785a8fd37ae0bb671c774dd833c9e0849ee453c531211efdc51f92173f5d38a` |
| Official XLSX | `6edeed758c174580b8152cf0c74b1b5b8b29735314f1d3e8139f7bf160339c60` |
| Canonical live page | `e4fddd46b6e3330dc01d0f621ddca8d5703e626bd4fcf19337a2b30d89a5a1f4` |
| Current data-rights page | `a47c620cd929e92f4ea747f1f9cb2573c93fa0049b51a36b9b1284ff691fadb8` |
| Checked data-rights record | `8cb839b56ad7804a4b49c47f5ade3b7f2c65428b4e4915cfda5089c549c7d79a` |
| Source crosswalk | `b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735` |
| Normalized ordered roster | `b26e7aca4881529e65b41ad29626eba4d0b370426b6db9dc6edce0bbbfd903a2` |
| Checked candidate fixture | `48fdd0c639beb2a7cb8ad6a103d47d5f7fe9a09d9a322cfd199b51a682ebad4b` |

The normalized roster digest hashes compact JSON for the ordered `ordinal`, `mntnId`, normalized official name, and elevation projection. The builder derives and checks it before writing the fixture. Every source member ID has the form `kfs:<mntnId>`. The source descriptor requires exactly eight ASCII digits and the same digits in both fields. The fixture keeps Korean and Hanja names, official heights, and no coordinates. Coordinates come from the separate OSM review.

## Destination review

The review used the full South Korea `natural=peak` OSM snapshot, the exact Hallasan `natural=volcano` node, Hallasan Wikidata evidence, and a repeatable-read, read-only Peaks production catalog snapshot. OSM supplies points and stable node IDs under ODbL. KFS supplies roster identity, names, heights, and location qualifiers.

| Input or output | SHA-256 |
| --- | --- |
| OSM query | `3b0177b5cdb2b30f3b3ebe39ffc8610c4b00573587146e1ec7e5b589374df1b7` |
| OSM South Korea peak snapshot | `6275b316fa55d2f6a183ee92397564d51316fad78cf89239bad866d0ab95beba` |
| Hallasan OSM snapshot | `81555ca3d807090015823e94ab83b7341ee496bde36d5f859cda20ce1b453575` |
| Hallasan Wikidata evidence | `51b317cac3cf121b733750335a442571c9cb2bea9a6c7959391e3293d3fa9c89` |
| Production catalog snapshot | `f0824ae26adfa1e0c6f35071a593fe4bbf6729bd465fb04ae728e801b0adbe9d` |
| KFS copyright page | `19d446eb3c37fc75eedc1395b19f9c16a6c1260cec5a66f715ba1f1e2bdd419e` |
| Reviewed coordinate builder | `0692a47e2adcc3f5b1069f74c09e6c6e0e706753444bda0eb340151678b9425b` |
| Reviewed coordinate crosswalk | `949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636` |
| Reviewed coordinate CSV | `708400e8e904743ba8c9395aaddcb0cacb44ae84be1bca4daa416c8140813769` |
| Reviewed coordinate audit | `46b60bf2cf5f5ae9f169e92c9443b6fd865043e2442beb88dad7d06f8f4df6af` |
| Checked identity resolutions | `e75b6368d95ef5d860644c992849623234d21bf3b01082a06960dcb9db368968` |

The review has 95 `confirmed` rows and five `confirmed_with_documented_source_conflict` rows:

Each of the 38 existing-destination decisions also pins the complete reviewed external-ID set. The importer rejects a missing, added, or changed ID before it can bind that KFS member.

- 변산(의상봉): KFS says 459 metres; OSM says 546 metres. The exact qualifier and Buan/Byeonsan location resolve the summit.
- 신불산: KFS says 1159.3 metres; OSM says 1209 metres. The point, name, and location resolve the summit.
- 지리산(통영): KFS says 399.3 metres; OSM says 368 metres. The Tongyeong/Saryang location separates it from mainland Jirisan.
- 치악산(비로봉): KFS says 1282 metres; OSM and the existing destination say 1228 metres. The existing OSM identity and point resolve the summit.
- 화악산: the workbook says 화악산 at 1468.3 metres while the live page says 화악산(중봉). The roster-height main summit is selected; a distinct 1446.1-metre Jungbong remains separate.

The six manual choices are:

| KFS member | Selected OSM node | Rejected OSM nodes | Reason |
| --- | ---: | --- | --- |
| 남산(금오산) | `5376919634` | `8566947054`, `288169256` | The selected 495.1-metre Gyeongju point matches the KFS place. Seoul Namsan is remote. |
| 마이산(암마이산) | `9684280383` | `10230534291` | The official qualifier selects Ammaibong, not nearby Sutmaisan. |
| 변산(의상봉) | `10250409125` | `5515194626` | The selected point is in KFS Buan/Byeonsan; the lower-height-delta name match is near Seoul. |
| 속리산 | `1862839218` | `10252764073` | Songnisan's high point is Cheonwangbong. The rejected name only contains the same string. |
| 한라산 | `8334051398` | `7036109099` | OSM and Wikidata link the exact 1947-metre identity to the volcano node. |
| 화악산 | `11637337293` | `5429893547`, `7972716230` | The selected main summit matches the roster height. One node duplicates it and Jungbong is a distinct top. |

The review also rejected four remote same-name production rows: Seoul Namsan, the Gwangyang record for Pocheon Baegunsan, the same Gwangyang record for Jeongseon Baegunsan, and a remote production Palgongsan.

## Trail archive handoff

KFS publishes a [national hiking-trail archive](https://www.data.go.kr/data/3034022/fileData.do). The complete download came from `https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/mount/mountain.zip`.

- Size: `265601808` bytes
- SHA-256: `e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72`
- Nested mountain IDs: 2,932
- Matching nested formats: SHP, KFS `_geojson`, and GPX

The portal says 2,919 rows while the archive contains 2,932 mountain IDs. Route work must explain that count gap before it calls the source ready to publish. The bundled notes trace the data to GPS work from 2007–2010, local-government data from 2015–2016, and a final 2016-12-31 change. The archive can prove geometry and KFS mountain identity. It cannot prove current access, closures, or advice.

The KFS `_geojson` files are Esri JSON in `PCS_ITRF2000_TM`, not RFC GeoJSON or WGS84. A route adapter must validate the exact projection, transform it to WGS84, require exact `MNTN_ID`, keep stable section and start/end point IDs, and ignore zero GPX heights. Archive start/end points are trailhead candidates, not proof of public access. A current source must prove access before any route becomes publishable.

## Production dry run

The importer ran through the approved database wrapper with PostgreSQL `default_transaction_read_only=on`, its own repeatable-read read-only transaction, and no `--apply` flag.

- `apply=false`
- `complete=true`
- 100 of 100 members resolved
- 62 destination additions planned
- 0 catalog repairs planned
- 100 list memberships planned
- 0 removals
- 0 unresolved issues
- Exact pretty-JSON report SHA-256: `cb5de75fe21397c32f808af47f8380e065bf32c533904c55468e399eaefc749e`

A committed in-memory second-import test supplies all 100 reviewed destinations and all 100 current memberships. It produces zero destination additions, repairs, membership additions, removals, reorders, or issues. No production row changed.

Final checks passed: 51 focused KFS/importer tests, the TypeScript build, `git diff --check`, and the full 835-test migration suite with 827 passes, eight configured integration skips, and zero failures.

## Photo rule

No KFS photo is part of this change. Destination covers must come from Wikimedia Commons or another source whose reuse terms, author, and page URL pass the photo-candidate checks. A person must approve each candidate before the destination hero fields change. Route covers then derive from those approved destination hero fields. The final production audit must show no listed destination without a cover and no active route without a cover.
