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
- `raw/usfs-rec-sites-trailheads.jsonl` — the raw EDW pull. The importer reads
  it too and refuses to run without it: the normalized files drop
  `fee_charged`, `public_site_name`, and `region`, and the importer needs all
  three (a no-fee claim the dataset contradicts, the name Peaks catalogs a
  trailhead under, and the region a page row's coordinates must come from).

The work order also updates `STATUS.md` with row counts and the sample-audit
error rate. Read it before importing: an error rate above about 1 percent means
fix the extraction first, not the import.

## 2. Import

Point the Cloud SQL Auth Proxy and the `DB_*` variables at the target database
(see the Migration section of `cloud-sql/CLAUDE.md`), then dry-run:

```bash
cd cloud-sql/migrate
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data --sample-payloads=5
```

The dry run reads every row, matches it against the catalog, and prints what
would change without writing. `--sample-payloads=N` prints the N richest
would-be payloads with the destination each would land on, so the decision to
apply rests on real output rather than on counts alone. Read those, check the
counts, then apply:

```bash
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data --apply
```

A row is imported only when a Peaks destination with the `trailhead` feature
sits within 250 m of the source point **and** one of the row's names — the EDW
site name or the public site name — either scores above the similarity
threshold or is a whole-token subset of the destination's name (at least two
tokens). Matched rows are listed in `import-matched.jsonl` with the rule that
carried each one; read the containment matches on a dry run before applying,
since that rule is the looser of the two.

Rows that fail either gate are written to `import-unmatched-fees.jsonl`,
`import-unmatched-bathrooms.jsonl`, and `import-unmatched-pages.jsonl` in the
data directory, each with the reason and the nearest candidate. Those files are
the place to look when expected facts do not appear.

Writes merge into `destinations.amenities`: unrelated blocks stay, unchanged
rows are not rewritten, and a leaf written by another source is left alone. A
re-run is safe.

Read the per-source counts the run prints. Two of them matter most: rows
refused because the raw dataset contradicts a no-fee claim, and rows written on
a quote alone. The raw pull covers recreation sites only, so fee rows from the
recreation-opportunities dataset have nothing to cross-check — their no-fee
claims rest on their extracted quote, and they are counted as
`fee_required_false_quote_only` rather than passed off as verified.

Every run records one row per source in `data_source_runs` (`--no-log` skips
it). `run_kind` is `import`; a dry run is logged with status `dry_run`, so it
does not count as a refresh.

## 3. Check freshness

```bash
npm run check:data-freshness
```

It reads the `data_source_freshness` view and exits non-zero when `usfs_fees`
or `usfs_bathrooms` has gone more than 90 days without a successful import, or
has never run. A non-zero exit means step 1 is due. `--json` prints the same
assessment for a script to read.

`usfs_pages` is imported and logged the same way but does not fail the check:
the page sections contribute a single leaf across the whole catalog, so an
alarm on them would be noise. The report still lists the source, marked
`[other]`, so its age is visible.

## 4. Access-road data (separate cadence)

The road sources — USFS RoadCore, USFS MVUM and BLM GTLF — refresh on their own
schedule and never touch the `peaks` database. Full detail in
`roads-processing-store.md`; the refresh sequence is: re-download per
`docs/trailheads/data/raw-datasets-manifest.jsonl`, then

```bash
npm run roads:import -- --data-dir=/path/to/peaks/docs/trailheads/data
```

Watch two things in the output. Row counts print against the manifest, so a
short download is obvious. And any BLM route-use-class value the reviewed map
cannot answer for is printed as a **WARNING**, with the row count and the
reason.

### The reviewed BLM map carries two decisions per row

`docs/trailheads/data/blm-route-use-class-map.jsonl` is the shared reviewed
artifact for BLM's dirty `OBSRVE_ROUTE_USE_CLASS`. Each of its 26 rows carries:

- **`canonical_class`** — what vehicle the class means (`2wd`, `4wd`,
  `4wd_high_clearance`, `atv`, `unknown`).
- **`drivable`** — whether the class belongs in the road graph at all. Six rows
  are `false`: Non-Motorized, Non-Mechanized, Motorized Single Track (both
  spellings) and Over Snow Vehicle. ATV and UTV are `true` — they are motorized,
  and the vehicle rank already says "ATV only".

Both are needed because they answer different questions. The canonical class
folds a motorcycle single-track into `unknown`, which is right for "what
vehicle" — there is none — and useless for "is this a road".

**A class the map does not cover, or covers without a `drivable` flag, is kept
out of the graph and reported.** So when a refresh introduces a new spelling,
the run warns and the road goes missing rather than a hiking trail quietly
becoming a drivable connection. Review the value, add a row with both fields,
and re-run. Do not add a row with only a `canonical_class`.
