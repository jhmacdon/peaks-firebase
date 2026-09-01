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
  underscores, percent escapes, Commons/English Wikipedia host variants, and
  renamed file aliases cannot reopen or requeue a denied image.
- A legacy Wikimedia review without a stored SHA-1 must still resolve to one.
  A deleted, hidden, or otherwise unresolved old file blocks a new proposal for
  that destination instead of weakening the review history.
- The write transaction checks list ownership, destination ownership, current
  name, location, Wikidata identity, cover credit, pending review state, and
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

The command accepts images used by an exact English Wikipedia article. A
stored Wikidata Q-id must resolve to that article, and the Wikidata and article
coordinates must remain within 5 km of the catalog point. Without a stored
Q-id, exactly one same-named Wikipedia geosearch result must sit within 1.5 km;
that article must publish its own Q-id and coordinates.

The article lead image gets first review. If review history already contains
that file, the command may use another article image only when its file title
names the destination. Each proposed file must have all of these fields from
Wikimedia imageinfo:

- a direct `upload.wikimedia.org` bitmap URL;
- an exact Commons or English Wikipedia `File:` page;
- a named, non-generic photographer;
- a matching CC BY, CC BY-SA, CC0, or public-domain label, version, and license
  URL;
- MediaWiki's 40-character hexadecimal image SHA-1;
- a supported JPEG, PNG, or WebP format; and
- dimensions of at least 1600 by 900 pixels.

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

Monthly fixed cost impact: **$0**. The command runs only when an operator starts
it and adds no service, timer, instance, or scheduled job.
