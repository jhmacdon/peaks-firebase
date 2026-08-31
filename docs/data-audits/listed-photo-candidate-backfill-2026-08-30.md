# Listed summit photo candidate backfill — 2026-08-30

`cloud-sql/migrate/src/backfill-listed-destination-photo-candidates.ts` builds
the admin photo review queue from the live catalog. It does not use a fixed
manifest. Its source query selects each Peaks-owned destination on any
Peaks-owned list when the destination lacks an image, photo credit, or credit
link.

## Safety contract

- Dry-run is the default. Only `--apply` can add rows.
- The command inserts `pending` rows in `destination_photo_candidates`. It
  never writes `destinations.hero_image` or any cover credit field.
- A database trigger locks the destination for every pending insert. The listed
  backfill skips its insert when any pending row already exists, and a scoped
  unique index permits at most one pending row from this backfill. Manual and
  manifest writers can still offer reviewed alternatives.
- The command reads the full source history before each insert. It compares
  decoded file-page identities plus MediaWiki's image SHA-1. URL spaces,
  underscores, percent escapes, Commons/English/Korean Wikipedia host variants, and
  renamed file aliases cannot reopen or requeue a denied image.
- A legacy Wikimedia review without a stored SHA-1 must still resolve to one.
  A deleted, hidden, or otherwise unresolved old file blocks a new proposal for
  that destination instead of weakening the review history.
- The write transaction checks list ownership, destination ownership, current
  name, location, country, Wikidata identity, cover credit, pending review state, and
  source history again under lock.
- Any HTTP error or MediaWiki API error, including an HTTP-200 response with a
  top-level `error`, blocks the whole `--apply` phase. The audit keeps request
  errors apart from true source misses.
- `--apply` requires `--audit-output`. The command creates and writes the audit
  in the target directory before it starts the database transaction, rewrites
  the final queue results before commit, then moves the file into place after
  commit. An unwritable or full target rolls the transaction back. If the
  database does not confirm the commit, the command leaves the staged audit in
  place and reports that the write outcome is unknown.

## Source and identity checks

The command uses Korean Wikipedia for South Korean destinations and English
Wikipedia elsewhere. A stored Wikidata Q-id prefers the country wiki and falls
back to English when the country wiki has no article. The Wikidata item and its
coordinates must remain within 5 km of the catalog point. P625 must contain one
non-deprecated Earth point at its highest rank. The linked article must publish
the same Q-id. A country-wiki title must match the destination exactly; an
English fallback stays anchored by the stored Q-id, its point, its English
sitelink, and the article's matching Q-id. An article may omit a duplicate
coordinate, but any article coordinate must also remain within 5 km. Without a
stored Q-id, exactly one same-named result from the selected Wikipedia must sit
within 1.5 km; that article must publish its own Q-id and coordinates. Korean
name checks keep Korean letters, fold punctuation and parenthetical qualifiers,
and still require an exact result.

The article lead image gets first review. If review history already contains
that file, the command may use another article image only when its file title
names the destination. Each proposed file must have all of these fields from
Wikimedia imageinfo:

- a direct `upload.wikimedia.org` bitmap URL;
- an exact Commons, English Wikipedia, or Korean Wikipedia `File:` page;
- a named, non-generic photographer;
- a matching CC BY, CC BY-SA, CC0, or public-domain label, version, and license
  URL;
- MediaWiki's 40-character hexadecimal image SHA-1;
- a supported JPEG, PNG, or WebP format; and
- dimensions of at least 1600 by 900 pixels.

Korean file titles and the local `파일:` namespace normalize to the same review
identity as `File:`. Korean map, logo, flag, unknown-author, uploader, and
own-work labels fail the same checks as their English forms.

After every article image fails, two human-checked Korean peaks may use the P18
file on the same stored Wikidata item:

- Daedunsan (`Q5208179`): `File:Chilseongbong at Daedunsan.jpg`, Yoo Chung,
  CC BY-SA 3.0, 5483 by 2050, SHA-1
  `0632cdaca83add61f33ebfde6f541b870469ff98`.
- 민주지산 (`Q8533668`): `File:Minjujisan Muju.jpg`, Ha98574 (Min's), CC BY-SA
  3.0, 1600 by 1200, SHA-1
  `551de49c173c77197d9ad0ce091470cccf367e16`.

The code freezes this two-file set and checks the Q-id, P18 title, SHA-1,
credit, license, and size again. It rejects all other P18 files. It does not
use P373, Commons categories, or file geosearch. A match still creates only a
pending row for human review.

Daedunsan's Korean article title differs from its English catalog name. The
article-image path still rejects that name mismatch. The frozen P18 path may
continue only because the stored Q-id, Wikidata point, linked article Q-id, and
any article point all match. It does not use that article's images.

Five more KFS rows have one human-reviewed Commons file each. This is a closed
destination-to-file table, not a new search path:

- 덕숭산(수덕산): `File:충남 서산 덕산 덕숭산 Korea - panoramio.jpg`;
- 도봉산(자운봉): `File:Geology of South Korea - Dobongsan Peaks (도봉산 정산)
  (3578202462).jpg`;
- 북한산(백운대): `File:Geology of South Korea - Bukhansan (북한산)
  (9581214596).jpg`;
- 팔공산: `File:팔공산.jpg`; and
- 황매산: `File:황매산.jpg`.

A second review froze seven more exact files:

- 무등산: `File:Mt Mudeungsan - panoramio - gary4now (1).jpg`;
- 비슬산: `File:Peak of Cheonwangbong at Biseulsan.jpg`;
- 소백산: `File:Sobaeksan 2.jpg`;
- 속리산: `File:Songnisan as seen from Cheonwangbong.jpg`;
- 오대산(비로봉): `File:Odaesan Mountain.jpg`;
- 월출산: `File:Wolchulsan National Park - panoramio - gary4now.jpg`; and
- 치악산(비로봉): `File:Chiaksan National Park.jpg`.

Each full-size image was checked for a clear mountain view and safe wide crop.
Commons reports one camera point for each file, 40 to 958 metres from the
reviewed summit. The exact-file records pin the named photographer, compatible
CC license, dimensions, SHA-1, source page, and camera point. A read-only run of
the existing article path found no candidate for these seven rows, so this set
does not duplicate the earlier strict candidates.

The same review rejected `File:삼악산 정상 3.jpg` because the strict article
path already covers 삼악산; `File:설악산 대청봉 정상석.jpg` because the marker
and cloud do not give a useful mountain view; `File:남이바위 축령산 2.jpg`
because it is a close view of boots and rock; `File:Maisan - panoramio.jpg`
because its tall framing does not survive a wide cover crop; both
`File:Geumjeong Mountain - panoramio (1).jpg` and
`File:釜山-金井山-姑堂峰.jpg` because they show dark close rock or a tall summit
marker; and `File:Mt.Taebaek Somunsubong.jpg` because it names a different
Taebaeksan subpeak.

For these twelve destination IDs, the command uses `reviewed_commons_file`
evidence instead of `wikipedia_article` evidence. It requires the exact saved
name, South Korea country code, KFS list membership, nullable planned Wikidata
value, and a catalog point within 25 metres of the reviewed KFS import row. It
then asks Commons for the one exact title with only `imageinfo` and
`coordinates`. It does not request redirects, categories, P373, nearby files,
or geosearch. The returned File page, author, license, dimensions, SHA-1, and
single coordinate must equal the frozen review. That coordinate must stay
within 25 metres of the reviewed file point and within 1.5 kilometres of the
summit. Any mismatch stops that row. A pinned ID never falls through to article
or P18 discovery. Seoraksan has no reviewed binding in this set.

The same final guards still apply. A pending photo skips all source requests.
An old source or SHA-1 stays final, including a denied image. The write lock
rechecks the cover, pending state, exact row identity, KFS membership, and
review history. A passing result adds only a pending photo review row; it never
writes a hero image.

Commons sometimes reports an HTTP localized Creative Commons deed URL. The
command keeps the reported license family and version, and stores its canonical
HTTPS license page because the review table requires HTTPS.

## Run and audit

Apply
`cloud-sql/migrations/20260830_destination_photo_candidate_identity.sql` before
using this command against an existing database. The migration adds the writer
origin and image identity checks and rejects malformed non-null identities. It
does not infer identities for older rows, discard them, or choose between
reviews. The command resolves older Wikimedia rows at run time and stops that
destination when it cannot.

```bash
cd cloud-sql/migrate
npm run backfill:listed-photo-candidates -- \
  --audit-output=/tmp/listed-photo-candidates.json

# Queue only after the dry-run audit has been checked.
npm run backfill:listed-photo-candidates -- \
  --apply \
  --audit-output=/tmp/listed-photo-candidates-applied.json
```

`--limit=N` caps Wikimedia inspection while the audit still lists every cover
gap and marks the rest `deferred_by_limit`. The JSON audit includes every
destination and list, each outcome and reason, rejected image metadata, the
full proposed source and credit record, and the final queue result in apply
mode. Its top-level shape is:

```json
{
  "generatedAt": "2026-08-30T00:00:00.000Z",
  "mode": "dry-run",
  "scope": "all Peaks-owned list members without a usable credited cover",
  "fixedMonthlyCostUsd": 0,
  "totals": {
    "coverGaps": 0,
    "inspected": 0,
    "deferredByLimit": 0,
    "pendingReview": 0,
    "candidatesFound": 0,
    "queued": 0,
    "misses": 0,
    "requestErrors": 0
  },
  "outcomes": {},
  "details": []
}
```

The zeroes show the output shape, not a production result. This change made no
production database writes.

## Checks

- TypeScript build passed.
- Unit coverage exercises default dry-run behavior, full live-list scope,
  stable identity, MediaWiki API errors, metadata parsing, exact license-version
  matching, generic-credit rejection, durable denied-image identity, database
  race guards, audit staging, null coordinates, and request failure handling.
- The full migration suite passed 770 tests with 9 unrelated database suites
  skipped when their test URLs were absent. A separate `peaks_test` run applied
  this migration in a task-only schema and checked both writer orders, SHA-1
  format, and duplicate-image rejection against PostgreSQL.
- A read-only live check for Mount Rainier (`Q194057`) resolved the same
  Wikidata and Wikipedia coordinates and read its Commons lead image with a
  named photographer, CC0 license page, and 5611 by 3741 dimensions. The full
  candidate plan passed all gates. It made no database call.
- The P18 follow-up passed all 42 focused tests and the TypeScript build. The
  full migration run passed 782 tests and skipped 9 database suites whose test
  URLs were absent. A read-only live Wikimedia check produced the two frozen
  candidates with their pinned source pages, credits, and SHA-1 values. It made
  no database call.
- The five-file reviewed Commons follow-up checks every accepted binding plus
  catalog drift, source drift, exact request shape, review history, and the
  final queue lock. Its 50 focused tests and TypeScript build passed. The full
  migration run passed 790 tests and skipped 9 database suites whose test URLs
  were absent. A read-only live run of the five exact-title Commons calls
  returned each frozen title, one coordinate, author, license, size, and SHA-1.
  It made no production database write.
- The seven-file follow-up repeats those checks for all twelve frozen bindings.
  Its 50 focused tests and TypeScript build passed. The full migration run
  passed 790 of 799 tests and skipped 9 database suites whose test URLs were
  absent. Each new file passed a full-size visual review and a read-only
  exact-title Commons metadata check. The current strict article path missed
  all seven rows. This follow-up made no production database write.

Monthly fixed cost impact: **$0**. The command runs only when an operator starts
it and adds no service, timer, instance, or scheduled job.

The Korean-language lookup follow-up on 2026-08-31 kept that **$0/month** cost.
It added no hosted service or scheduled work.

The two-file P18 fallback also costs **$0/month**. It runs only inside the same
operator-started command and adds no service, timer, or scheduled job.

The five reviewed Commons bindings also cost **$0/month**. They use the same
operator-started command and add no hosted service, timer, or scheduled job.

The seven-file reviewed follow-up also costs **$0/month** and adds no hosted
service, timer, instance, or scheduled job.
