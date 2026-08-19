# Trailhead data refresh

Parking, fee, and bathroom facts on Peaks trailheads come from two public US
Forest Service sources: the EDW recreation-site and recreation-opportunity
datasets, and the Forest Service site pages. Both drift — fees change every
season, restrooms close, pages get rewritten — so refresh the whole chain once
a quarter, or sooner when the freshness check fails.

The importer only fills in facts on trailheads Peaks already has. It never
creates a destination and never deletes one.

## 1. Regenerate the normalized JSONL

Re-run the Codex work order at `docs/trailheads/codex-handoff.md` (in the
`peaks` checkout, outside this repo). It downloads the sources again and
rewrites these files in `docs/trailheads/data/`:

- `trailhead-fees.jsonl`
- `trailhead-bathrooms.jsonl`
- `fs-page-sections.jsonl`
- `fs-trailhead-page-registry.jsonl`

The work order also updates `STATUS.md` with row counts and the sample-audit
error rate. Read it before importing: an error rate above about 1 percent means
fix the extraction first, not the import.

## 2. Import

Point the Cloud SQL Auth Proxy and the `DB_*` variables at the target database
(see the Migration section of `cloud-sql/CLAUDE.md`), then dry-run:

```bash
cd cloud-sql/migrate
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data
```

The dry run reads every row, matches it against the catalog, and prints what
would change without writing. Check the counts, then apply:

```bash
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data --apply
```

A row is imported only when a Peaks destination with the `trailhead` feature
sits within 250 m of the source point **and** the two names are similar enough.
Rows that fail either gate are written to `import-unmatched-fees.jsonl`,
`import-unmatched-bathrooms.jsonl`, and `import-unmatched-pages.jsonl` in the
data directory, each with the reason and the nearest candidate. Those files are
the place to look when expected facts do not appear.

Writes merge into `destinations.amenities`: unrelated blocks stay, unchanged
rows are not rewritten, and a leaf written by another source is left alone. A
re-run is safe.

Every run records one row per source in `data_source_runs` (`--no-log` skips
it). `run_kind` is `import`; a dry run is logged with status `dry_run`, so it
does not count as a refresh.

## 3. Check freshness

```bash
npm run check:data-freshness
```

It reads the `data_source_freshness` view and exits non-zero when
`usfs_fees`, `usfs_bathrooms`, or `usfs_pages` has gone more than 90 days
without a successful import, or has never run. A non-zero exit means step 1 is
due. `--json` prints the same assessment for a script to read.
