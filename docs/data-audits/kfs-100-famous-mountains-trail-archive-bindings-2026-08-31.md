# KFS 100 Famous Mountains trail archive bindings — 2026-08-31

## Result

The checked Korea Forest Service trail archive binds 83 of the 100 reviewed
KFS list members to 90 official archive packages. Seventeen members remain
unresolved. No weak name match and no line beyond the 250 m summit gate was
accepted.

This is a `validation_only` artifact. The archive dates to 2016 and cannot
prove that a trail is open now. It also does not prove a public trailhead.
Route publication still needs current access proof, a reviewed trailhead, and
the normal route checks.

The work adds no service and no monthly cost. It stores one static fixture and
runs only when called in local work or tests: **$0/month**.

## Checked inputs

| Input | Check |
| --- | --- |
| KFS source crosswalk | `b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735` |
| KFS coordinate crosswalk | `949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636` |
| KFS trail archive | 265,601,808 bytes; `e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72` |
| Checked binding fixture | `702644cd55137355625b124fb1a70260f6d30fd205a853dd88dcee169d5c0081` |
| Minimal route validation input | `0c1599b2e55dd62532ced16f7e1046b228e769fb88c44316a37f9aef3e614288` |

Archive source:
[Korea Forest Service mountain trail download](https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/mount/mountain.zip).

The ZIP has 2,932 current mountain package codes. Each code has one Shapefile
ZIP, one Esri JSON ZIP, and one GPX ZIP: 8,796 current package files. The outer
ZIP has 8,802 entries in all: those files, five backup-suffixed files, and the
directory entry. Review ignored the five backups because their names do not
match the exact current package forms. The public catalog says 2,919 records.
The downloaded file therefore has 13 more current package codes than the page
count. The binding pins the downloaded bytes and records this gap rather than
treating either count as a substitute for the other.

## Method

1. Verify the two list fixture hashes, archive hash, byte size, and all three
   2,932-package counts before review.
2. Join each list row only through its checked eight-digit KFS roster ID to its
   reviewed destination and summit point. The roster ID never serves as an
   archive package match.
3. Read `MNTN_CODE`, `MNTN_ID`, and `MNTN_NM` from every official Esri JSON
   polyline and point layer. Keep the nine-digit package code and every
   nonblank line `MNTN_ID` exactly as published.
4. Read WGS84 line points from the matching GPX package. Ignore every GPX
   elevation because the archive writes zero for it.
5. Generate candidates from Korean line names, Korean point names in the same
   package, and nearby geometry. Common names remain separate until the
   reviewed summit location picks the right package.
6. Measure the closest point on every GPX segment in a local tangent plane at
   the summit, using an Earth radius of 6,371,008.8 m. Round the result to
   0.1 m. Package bounds serve only as a safe lower bound; the scan stops only
   after no unchecked package can beat the current nearest line.
7. Confirm a package only when its reviewed identity is strong and its line
   comes within 250 m of the reviewed summit. Keep every package that passes
   both gates. Leave a row unresolved when the close line has another identity
   or the matching line misses the summit gate.

The 90 accepted bindings split into 73 exact line names, 15 line names with a
local summit or trail qualifier, one same-package point-name match, and one
reviewed spelling variant. Seventy-nine lines come within 25 m, seven fall
between 25 and 100 m, and four fall between 100 and 250 m.

Seven list rows have two accepted packages: 감악산, 관악산, 모악산, 민주지산,
백덕산, 응봉산(매봉산), and 천태산. Each package has its own checked identity
and distance. No package code appears under two list rows.

The separate route-adapter input projects only these 90 confirmed bindings to
the adapter's exact shape: `schemaVersion`, `sourceId`, `archiveSha256`, and
`bindings`; each binding has only `destinationId` and `packageId`. It contains
83 destinations and no unresolved row.

## Source disagreements kept in the artifact

- The portal count is 2,919; the downloaded archive has 2,932 package codes.
- A package code is not a safe stand-in for `MNTN_ID`. Of the 90 accepted
  packages, 46 do not carry their package code in the line `MNTN_ID` set, and
  34 carry more than one `MNTN_ID`. Both fields stay separate.
- 성인봉 package `479400103` names the line `울릉군숲길`, but its point layer
  names 성인봉 and the line comes within 2.6 m. That same-package evidence is
  strong enough for a binding.
- 황악산 package `437403701` names the line `황학산`, while its point layer
  also names 황악산. The line comes within 4.7 m. The separate exact-name
  package `437403801` is 1,781.7 m away, so the close spelling variant wins.
- 마이산, 천성산, and 팔공산 come within 223.9 m, 146.1 m, and 100.6 m. They
  pass the fixed 250 m gate, but the fixture calls out each margin.
- 화악산 has an exact-name line 301.5 m away. It fails the same gate and stays
  unresolved.

## Unresolved rows

| # | KFS ID | Mountain | Nearest archive line | Distance | Reason |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `20000004` | 가리산 | `427207401` 새득이봉 | 0.0 m | The line is close, but neither its line nor point layer identifies 가리산. |
| 3 | `20000009` | 가야산 | `488906604` 남산숲길 | 3,037.1 m | No matching line reaches the summit. |
| 7 | `20000040` | 계룡산 | `447600103` 금남정맥 | 85.0 m | The line is close, but the package does not identify 계룡산. |
| 12 | `20000934` | 금산 | `488403901` 호구산 | 4,243.3 m | Same-name packages resolve to other places. |
| 17 | `20000108` | 남산(금오산) | `317104401` 묵장산 | 7,119.1 m | Common 남산 and 금오산 names resolve to other places. |
| 19 | `20000112` | 내장산(신선봉) | `451803401` 월봉 | 3,818.8 m | Neither a 내장산 nor 신선봉 package reaches the summit. |
| 21 | `20001321` | 대암산 | `428100403` 백두대간트레일인제 | 2,411.4 m | The exact-name package is still 4,351.7 m away. |
| 35 | `20000225` | 무등산 | `467902501` 안양산 | 693.3 m | The package whose point layer mentions 무등산 is 2,349.2 m away. |
| 42 | `20000276` | 백암산 | `468800501` 공원산 | 5,403.4 m | Exact-name packages resolve to other places. |
| 46 | `20000775` | 변산(의상봉) | `458000201` 계화산 | 11,664.2 m | No matching identity reaches the summit. |
| 59 | `20000455` | 오대산(비로봉) | `421504602` 오대산_노인봉 | 2,330.1 m | The archive line reaches another 오대산 summit, not 비로봉. |
| 67 | `20000507` | 월출산 | `468102904` 노릿재 | 1,999.0 m | No matching identity reaches the summit. |
| 86 | `20000628` | 치악산 | `421300901` 매봉산 | 10,658.5 m | No matching identity reaches the summit. |
| 93 | `20000661` | 한라산 | `491300204` 동백길 | 4,619.2 m | The archive has no line near the summit. |
| 94 | `20000679` | 화악산 | `418204301` 화악산 | 301.5 m | Exact identity, but the line falls outside the 250 m gate. |
| 99 | `20000688` | 황장산 | `431501201` 대미산 | 2,190.6 m | Exact-name packages are more than 181 km away. |
| 100 | `20000699` | 희양산 | `437603501` 악희봉 | 939.4 m | The exact 희양산 line is 1,058.0 m away. |

## Files

- Checked data:
  `docs/data-audits/fixtures/keeper-list-kfs-100-famous-mountains-trail-archive-bindings-2026-08-31.json`
- Minimal route validation input:
  `docs/data-audits/fixtures/kfs-100-famous-mountains-trail-archive-validation-input-2026-08-31.json`
- Strict parser:
  `cloud-sql/migrate/src/kfs-trail-archive-bindings.ts`
- Tests:
  `cloud-sql/migrate/src/__tests__/kfs-trail-archive-bindings.test.ts`

The parser rejects changed source hashes, archive facts, row counts, duplicate
IDs, duplicate package bindings, extra or missing fields, unreviewed identity
types, unresolved rows with bindings, and confirmed lines beyond 250 m.
