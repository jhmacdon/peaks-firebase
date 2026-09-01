# Next active-route cover batch — 2026-09-01

This dry-run review accepts eight exact Commons files as pending photo candidate
plans. It does not apply a candidate, approve a photo, update a hero image, or
write to production.

The implementation starts at
`origin/codex/add-route-gap-cover-priority-20260901@b3218423f8832ca2474be32038f9093ca03acb55`.
It leaves the first six route-gap bindings and the KFS-only rules unchanged.

## Live route gap

The forced-read-only packet records 260 active Peaks routes. The current inline
cover projection finds 194 covers and 66 gaps. The two earlier candidate batches
would cover nine distinct gaps, leaving 57. These eight destinations link to ten
of those routes, so later approval of all eight would reduce the count from 57
to 47.

The 57→47 result is conditional. This change only prepares pending review rows.

- Query: [`next-active-route-cover-gap-query-2026-09-01.sql`](fixtures/next-active-route-cover-gap-query-2026-09-01.sql), 9,903 bytes, SHA-256 `9d5b41887cc519c8d04fec7cb040f832688d99498ddeceabb7af35f642ad8537`
- Exact live packet: [`next-active-route-cover-gap-audit-2026-09-01.json`](fixtures/next-active-route-cover-gap-audit-2026-09-01.json), 29,114 bytes, SHA-256 `bfda0523c0e6dff797ce69983ec1b8ba6b6c2472159f6365aa8263d6091759bb`
- Raw source replay: [`next-active-route-photo-priority-replay-2026-09-01.json`](fixtures/next-active-route-photo-priority-replay-2026-09-01.json), 30,356 bytes, SHA-256 `33979c11c6bb78eab3207ff84e9a5bb030f20c6b6ad896d7493af538ab52193e`
- Review record: [`next-active-route-photo-priority-review-2026-09-01.json`](fixtures/next-active-route-photo-priority-review-2026-09-01.json), 41,180 bytes, SHA-256 `8b100c25a9ce0a98dffd654868893e267a7775c8ce522d4cc76ef10530d1d3a0`

The database packet records both `default_transaction_read_only=on` and
`transaction_read_only=on`. It also records zero writes and no installed route
cover view; the query replays the reviewed route-cover SQL inline.

## Exact batch

| Rank | Destination | Active route links | Commons file | Identity proof | Original bytes | Original SHA-256 |
| ---: | --- | ---: | --- | --- | ---: | --- |
| 1 | Mount Monadnock | 2 | [Mount Monadnock as seen from Bald Rock.jpg](https://commons.wikimedia.org/wiki/File:Mount_Monadnock_as_seen_from_Bald_Rock.jpg) | Q289542 P18, response `8de4663295a115403c8e2832e4ea0487c327abba7893f278db3a8b9c03e076f2` | 3,072,663 | `3ff7750a856e16303305f43ba136c395fbabeda065076a95f95e7a25d11180ef` |
| 2 | Mailbox Peak | 2 | [Mailbox from Mount Teneriffe.jpg](https://commons.wikimedia.org/wiki/File:Mailbox_from_Mount_Teneriffe.jpg) | `Category:Mailbox Peak`, response `8bea08f2bc32aa068dfeb6ea50dd8e513dddc93123a989f0d7b3db2c515279a7` | 3,798,842 | `fd3daaf4d788d8ed81e905a4d6fefff489f1ca0495e92021e5d78dbcfd09954a` |
| 3 | Barre des Écrins | 1 | [La Barre des Écrins.jpg](https://commons.wikimedia.org/wiki/File:La_Barre_des_%C3%89crins.jpg) | Q30480 P18, response `d5d1f6ba67b3dd2ab59268674eb9070f72749f2b14a8fbefc8e4b78f89b0762d` | 6,948,456 | `176aa5aabd5bd55dff6db07d8aa237b57030cf61678b2eb75cf5b9f957d075f6` |
| 4 | Gran Paradiso | 1 | [Cogne gruppo gran paradiso (2).jpg](https://commons.wikimedia.org/wiki/File:Cogne_gruppo_gran_paradiso_(2).jpg) | `Category:Gran Paradiso`, response `cd45c2dbbe7b993f9df3431a8bcde7ea732d6dec7e0fec6fef562fe5bed61323` | 4,013,041 | `47f422930a0f82efa55074f0bd579059f1f8d05b48ad4578e43ffc2f0d8a9453` |
| 5 | Chamechaude | 1 | [Chamechaude-depuis-la-pinea.jpg](https://commons.wikimedia.org/wiki/File:Chamechaude-depuis-la-pinea.jpg) | Q2321630 P18, response `ebb83d70eeff85719eca2be8b6c1be7e5f62d10deb0e25c7786d0f63e012adac` | 5,468,071 | `bec237ecbdd757e18a3d715bbf9277444975d5a2f564e2b631e395b264989c8e` |
| 6 | Großglockner | 1 | [Großglockner (Hochgasser).jpg](https://commons.wikimedia.org/wiki/File:Gro%C3%9Fglockner_(Hochgasser).jpg) | `Category:Großglockner`, response `acbdb4fa3f311e8184eb6876747208f5d5b755c5e220ea3f711e83cb88161d14` | 13,367,183 | `012ee22ab1e7b460381699c8badd1836a31ae05b292cc8c7ac08252672b8bc7c` |
| 7 | Haleakala | 1 | [Haleakalā, Peak Shadow.jpg](https://commons.wikimedia.org/wiki/File:Haleakal%C4%81,_Peak_Shadow.jpg) | reviewed Q515719 P18, response `0866e233730f99234b27449fe14428bdcef5cba35987970f4fc2aeebf8ca47ff` | 1,988,099 | `4013e7c946157ead7606344d7cc4f97db82f58251a07a9ad6c360540c637b88a` |
| 8 | Middle Teton | 1 | [Middle Teton Grand Teton NP1.jpg](https://commons.wikimedia.org/wiki/File:Middle_Teton_Grand_Teton_NP1.jpg) | Q2060335 P18, response `c0fbbcdfceafebfa5173cb48c3afad39e42235390a06c8221978dca57c1c0ae7` | 6,830,066 | `ca68d10195dd8e7672f951ab46c6acd6fdd21e879a291aa6ccf248fd21aee5f6` |

The Haleakala catalog row has no Wikidata id. Its reviewed exact identity is
Q515719. The other seven reviewed Q-ids match the live catalog rows.

## Image checks

Each exact original was downloaded from `upload.wikimedia.org`. Its byte length,
SHA-256, SHA-1, width, and height match the pinned Commons response. Every full
frame, centered 2:1 crop, and centered square crop was viewed.

All eight passed. Mailbox Peak has the most sky, but the named peak stays clear
and centered in both crops. No file uses a person, sign, building, or wrong peak
as its subject.

The replay fixture embeds the raw bytes for eight exact Commons metadata calls,
five P18 calls, and three category calls. Tests decode all 16 replies, recompute
their hashes, and bind each proof to the exact file.

## List evidence

None of the eight rows belongs to a live Peaks list in the read-only packet.
Three have respectable future-list evidence in
[`peakbagger-list-candidates-2026-08-22.json`](fixtures/peakbagger-list-candidates-2026-08-22.json):

- Mount Monadnock is number 22 on New Hampshire 52 with a View.
- Barre des Écrins is number 52 on UIAA Alpine 4000-meter Peaks.
- Gran Paradiso is number 63 on UIAA Alpine 4000-meter Peaks.

This evidence affects rank only. It does not claim live list membership or alter
the list catalog.

## Closed contract

The existing listed scan still covers every Peaks-owned list member. The only
non-list rows added to scope are the exact reviewed active-route destination ids.
KFS bindings still require their exact KFS list and use their existing rules.

For this batch, planning and queue time both require the frozen destination id,
name, country, Wikidata id, coordinates, empty list arrays, empty review history,
raw cover fingerprint, and full active-route fingerprint. The route fingerprint
includes route id, name, owner, status, destination order, completion, distance,
gain, derived-cover state, and every linked destination id.

The exact Commons title must not redirect. Source page, photographer, license,
license URL, dimensions, media SHA-1, coordinate count, and saved coordinates
must match. P18-only bindings recheck the live P18 before fetching the file.
Category bindings carry the exact raw category response hash. Any drift returns a
miss or `identity_changed` before a pending row can be inserted.

The queue path inserts only `destination_photo_candidates`. It does not set a
status, so the database default remains `pending`. It never updates a hero image.

Fixed infrastructure cost: **$0/month**.
