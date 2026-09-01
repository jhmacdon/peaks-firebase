# Listed active-route cover priority review — 2026-09-01

This pass reviewed 11 listed destinations whose active routes had no derived
cover. It planned six new photo candidates, rejected four rows, and kept
Damavand's live pending candidate. It did not use `--apply` or write production
data.

## Live source

The exact read-only packet is
`docs/data-audits/fixtures/listed-active-route-cover-gap-audit-2026-09-01.json`.
It is 26,118 bytes and has SHA-256
`3fbc74c5416294771f03cc1d974974ed506a415052b230575aeb408b7c4a67b3`.
The packet records all 11 catalog rows, list memberships, cover fields, photo
review history, and 14 uncovered active route links. It used a read-only
transaction against `peaks`. The deployed route-cover view was absent, so the
audit replayed `cloud-sql/migrations/20260830_route_cover_photos.sql` inline.
It pins these source refs:

- route stack:
  `origin/codex/integrate-route-stack-main-20260831@ffcb01d0599ebab1d575eefc6c8a1e9c7f725ee4`;
- photo base:
  `origin/codex/add-two-kfs-global-covers-20260901@ae8c63390260b98ff751feead6d8067992f6535d`.

The review fixture is
`docs/data-audits/fixtures/listed-active-route-photo-priority-review-2026-09-01.json`.
It binds every decision back to the source packet. It also pins the Commons
request, response size and SHA-256, original file size and SHA-256, catalog
identity, list IDs and names, coordinates, and review history.

The exact replay is
`docs/data-audits/fixtures/listed-active-route-photo-priority-replay-2026-09-01.json`.
It is 26,476 bytes and has SHA-256
`7dcd04e9fa96c764878431bbec864ff0eaacd03a32858309f25270973e272939`.
It stores each of the six accepted metadata replies, four decisive rejection
replies, and Snoqualmie Mountain's exact Wikidata P18 reply as base64. Decoding
a row restores the exact response bytes, including the lack of a trailing
newline. Tests decode all 11 rows and recompute each saved byte count and
SHA-256. The `/private/tmp` paths record provenance; they are not the only copy
of the proof.

## Six pending plans

| Destination | Exact Commons file | Credit and license | Size | Media SHA-1 | Metadata SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| Mount Shuksan | `File:Mount Shuksan tarn.jpg` | Frank Kovalchek, CC BY 2.0 | 3422×2217 | `32bc1530395e0fdffd118beaa211adce366b01ad` | `095ad10c9a4a82179e897845f7133619cb1b680dee3310b609dcf145091f3b7b` |
| Granite Mountain | `File:Granite Mountain lookout - Flickr - brewbooks.jpg` | brewbooks, CC BY-SA 2.0 | 4128×3096 | `639a4196d3b7d465b78039ffeb9645fb79de46bc` | `f1c5f2cab8940c2e0802e9d54ef50ac40f5615db685b0eb43228c6bf2645eba2` |
| Kaleetan Peak | `File:Kaleetan Peak (from Abiel Peak).jpg` | Martin Bravenboer, CC BY 4.0 | 7555×4864 | `861dcbefb1d6a6870c396bd9ce1fe92d8b30fa38` | `98a71928e082213b0e8ab36b93995c2b5df8021ba7b956ba15f1e23eef91d0f3` |
| Mount Si | `File:Mount Si seen from Mill Pond Road in Washington state.jpg` | Ron Clausen, CC BY-SA 4.0 | 2272×1638 | `66f87cbad2d06650931b77494cf90663115f9cdb` | `d8948f1cc48aa744b12016c1494a2b5e0dc31f05152f7192d94c9e1359bb86a8` |
| Mount Everest | `File:Mount Everest as seen from Drukair2 PLW edit.jpg` | shrimpo1967; edit by Papa Lima Whiskey 2, CC BY-SA 2.0 | 2971×1615 | `f3374ad94a12cd8143edc347d1b9bc11feee05d5` | `c4b721a2844adfd755718fb9687f08ed68bb61a0e02dea22a3dd725a664481a7` |
| Snoqualmie Mountain | `File:Snoqualmie Mountain.jpg` | J Brew, CC BY-SA 2.0 | 3264×2448 | `7585707fb29192a32722d1d9e87d589db1be0a73` | `8a90d76d35a954bfdb1f1f70cf10c00046e7df43c6b165c0e0414a8a322ed9ac` |

Reviewers opened each original file. The six frames show the named mountain
clearly and leave room for later crop review. Granite Mountain has one camera
point 29.2 metres from the saved summit. The other five use frozen exact-peak
proof. Mount Shuksan, Mount Everest, and Snoqualmie Mountain use the exact
Wikidata item's P18 file. Kaleetan Peak and Mount Si use an exact Commons
category plus a title and description that name the peak. Their saved file
coordinate count is zero; the code does not copy a summit or viewpoint point
into that field.

Snoqualmie Mountain's P18 proof pins the exact `wbgetclaims` request for
Wikidata `Q7548046`, property `P18`. Its 625-byte reply has SHA-256
`2c2cb071a3219a0e86265018457bd70410f5c4712f6df260e5558e1ef11ee784`
and names `File:Snoqualmie Mountain.jpg`. The run-time check uses the same
exact-item, exact-property request and fails if the item or file changes.

The first Mount Si review used a cloudy sunset frame. A second full-frame pass
replaced it with the Mill Pond Road view above. The new original shows the full
mountain and its reflection, and both remain clear in wide and square crops.
The old sunset file is not in the route-gap table.

## Four strict rejects

- **Cleveland Mountain:** the target is Washington Wikidata `Q49020994`, not
  a same-name Montana or Colorado summit. It has no P18 or Commons category,
  and a 1.5-kilometre File-namespace search returned no files. The old denied
  lake photo stays denied.
- **Dirtybox Peak:** the 1.5-kilometre search found 17 files. They identify
  Mailbox Peak, Dirty Harry's Peak, Rattlesnake Ridge, or other scenery. None
  names Dirtybox Peak, and no exact Wikidata or Commons identity exists.
- **Mount Phelps:** the Washington target is Wikidata `Q49054013`. It has no
  P18 or Commons category, and the nearby search returned no files. Same-name
  New York files do not match. The old denied Bridal Veil Falls file stays
  denied.
- **Red Mountain:** the target is Kittitas County Wikidata `Q7304628`,
  Peakbagger 2158, GNIS 1524941. The nearby results are four map TIFFs. The
  strong new photos belong to the different Snoqualmie Pass summit
  `Q49067807`, Peakbagger 2107, GNIS 1524951. The old denied photo stays
  denied.

The fixture pins each 1.5-kilometre Commons query, raw response byte count,
SHA-256, result count, and title list. No check was loosened to raise the
accept count.

## Pending state and queue guards

Damavand already has pending candidate `ESlTsqMIbRL2SFATA_di` for
`File:990513-Damavand-IMG_4854-2.jpg`. The live state stops discovery before a
source request. This pass does not create a duplicate.

The six new files use `reviewed_active_route_commons_file` evidence in a new
generic route-gap table. They do not use or widen the KFS-only reviewed file
contract. The two maps must stay disjoint; an overlap fails before selection.
A bound row must keep the exact destination ID, name, country,
nullable catalog Wikidata value, ordered list IDs and names, catalog point,
and review-history fingerprint. Commons must return the exact file without a
redirect and must keep the pinned page, credit, free license, dimensions,
media SHA-1, coordinate count, and coordinate state. Camera proof must remain
within the summit radius. A zero-coordinate file must carry a valid `Q` ID
bound to the catalog ID when one exists, plus frozen P18 or a non-empty
canonical `Category:` proof. P18-only proof must name the pinned file in its
saved raw reply and in a fresh exact-item check. Old review rows without a
media SHA-1 are resolved before reuse, so a renamed copy of old media cannot
return. Any drift stops the row; it does not fall through to a new article or
nearby-file search.

The locked queue path checks the same catalog, list, cover, pending, and
history state again. A passing write can add only a `pending`
`destination_photo_candidates` row. It cannot update `destinations.hero_image`
or a credit field. This review did not run that write path.

## Cover effect if reviewers later approve all six

The six destination covers would supply derived covers to nine of the 14
target route links. The target gap would fall from 14 to 5. The global count
of active Peaks routes missing a derived cover would fall from 66 to 57. Two
of those nine links are publish-valid today; seven are not. Route validity is
a separate gate and does not change here.

The code has no new service, job, or runtime resource. Fixed monthly cost is
`$0`.

## Checks

Run these from `cloud-sql/migrate`:

```bash
NODE_ENV=test node --test --import tsx \
  src/__tests__/listed-active-route-photo-candidates.test.ts
npm test
npm run build
```

The source fixture must also match its packet byte for byte:

```bash
cmp -s \
  /private/tmp/listed-active-route-cover-gap-audit-2026-09-01.json \
  docs/data-audits/fixtures/listed-active-route-cover-gap-audit-2026-09-01.json
shasum -a 256 \
  docs/data-audits/fixtures/listed-active-route-cover-gap-audit-2026-09-01.json
jq -e '.decisions | length == 11' \
  docs/data-audits/fixtures/listed-active-route-photo-priority-review-2026-09-01.json
jq -e '.responseCount == 11 and (.responses | length == 11)' \
  docs/data-audits/fixtures/listed-active-route-photo-priority-replay-2026-09-01.json
```

Do not add `--apply` to this review batch.
