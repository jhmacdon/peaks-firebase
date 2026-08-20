# Trailhead data refresh

Parking, fee, and bathroom facts on Peaks trailheads come from two public US
Forest Service sources: the EDW recreation-site and recreation-opportunity
datasets, and the Forest Service site pages. The access-road facts — what the
drive in asks of a car, what the road is made of, when the gate is open — come
from three more: USFS RoadCore, USFS MVUM and BLM GTLF. All of them drift —
fees change every season, restrooms close, pages get rewritten, roads are
regraded and gates reissue their dates — so refresh the whole chain once a
quarter, or sooner when the freshness check fails.

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

## 2. Rebuild the access-road facts

The road sources refresh on their own download schedule and **never touch the
`peaks` database**: they are loaded into a local DuckDB store, walked once per
trailhead, and only the derived per-trailhead answers are imported. Full detail
in `roads-processing-store.md`. Two commands, in this order:

```bash
cd cloud-sql/migrate
# 1. Re-download per docs/trailheads/data/raw-datasets-manifest.jsonl, then
#    rebuild the store from scratch (about 30 seconds, roughly 4.5 GB).
npm run roads:import -- --data-dir=/path/to/peaks/docs/trailheads/data
# 2. Walk the graph once per trailhead. Reads the catalog read-only, for
#    trailhead ids, names and coordinates. Writes trailhead-road-access.jsonl.
npm run roads:derive -- --data-dir=/path/to/peaks/docs/trailheads/data --sample=20
```

**Update `raw-datasets-manifest.jsonl` as part of the download, before the
load.** Each dataset's `as_of` is the provenance date the derivation stamps on
every leaf it produces — `readSourceBook` reads it straight through to
`retrieved_at` — so a manifest left at last quarter's date puts last quarter's
date on this quarter's facts, and **nothing downstream can catch that**: the
date is well-formed, in range, and wrong. Set `as_of` to the day the files were
fetched and `row_count` to what the download actually holds.

Watch three things in that output. Row counts print against
`EXPECTED_ROW_COUNTS` in `import-road-network.ts`, pinned in code so a short or
truncated load shows up against a number that cannot move with the file — which
also means **drift on a refresh is expected**, not a failure. Read it, satisfy
yourself the difference is the agency's and not the download's, then re-pin the
constants to what the run printed. Any BLM route-use-class value the reviewed
map cannot answer for is printed as a **WARNING**, with the row count and the
reason. And `roads:derive` prints its own funnel — how many trailheads snapped,
how many reached a maintained road, how many carry a gate window, and how many
windows were withheld because a segment on the path is one MVUM never
described. Read the `--sample` narratives against a map before importing: they
are the cheapest check that the walk still finds sensible roads.

The importer in step 3 reads `trailhead-road-access.jsonl` and refuses to run
without it, so this step is not optional. A refresh that rewrote the fee and
bathroom files but left the road facts from the previous quarter would import
three quarters of itself and say nothing about the missing quarter.

### The reviewed BLM map lives in this repo

`cloud-sql/migrate/data/blm-route-use-class-map.jsonl` is the canonical copy of
the reviewed map for BLM's dirty `OBSRVE_ROUTE_USE_CLASS`, and it is the
default `roads:import` reads. It is version-controlled here because it is a
reviewed decision, not downloaded data — the sources it describes change, the
review does not, and an artifact nobody can diff is an artifact nobody can
review. Any copy in the data directory is derived: pass `--map=FILE` to use one
deliberately, and copy a change back here rather than editing it there.

Each of its 26 rows carries:

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
becoming a drivable connection. Review the value, add a row with both fields to
the repo copy, and re-run. Do not add a row with only a `canonical_class`.

## 3. Import

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

A fee, bathroom or page row is imported only when a Peaks destination with the
`trailhead` feature sits within 250 m of the source point **and** one of the
row's names — the EDW
site name or the public site name — either scores above the similarity
threshold or is a whole-token subset of the destination's name (at least two
tokens). Matched rows are listed in `import-matched.jsonl` with the rule that
carried each one; read the containment matches on a dry run before applying,
since that rule is the looser of the two.

Rows that fail either gate are written to `import-unmatched-fees.jsonl`,
`import-unmatched-bathrooms.jsonl`, and `import-unmatched-pages.jsonl` in the
data directory, each with the reason and the nearest candidate. Those files are
the place to look when expected facts do not appear.

The road rows skip both gates. `roads:derive` started from the catalog, so each
row already carries the destination id it belongs to and the importer writes by
exact id — its only question is whether that destination is still there and
still a trailhead. Ids that have gone, and rows the importer refused on their
own facts, land in `import-rejected-roads.jsonl` with the reason. Four refusals
are worth knowing by name:

- `skipped_*` — the derivation could not answer honestly (no road within the
  snap radius, no maintained road reachable, an unrated edge on the path, a
  route no highway vehicle belongs on). The whole row is skipped, including the
  facts it does carry: a partial answer under a skip reason reads as a complete
  one.
- `seasonal_window_evidence_gap` — the window rests on a path segment MVUM
  never described. `buildApproachRow` already withholds these, so one arriving
  here means that gate regressed; the run warns by destination id.
- `seasonal_window_not_iso` — a gate date that is not a real `YYYY-MM-DD` day.
  Never reformatted or guessed at.
- `seasonal_window_out_of_range` — the window is anchored more than a year from
  the run. Nothing in production trips this today; it is the guard against a
  derived file kept across a year boundary, or an anchoring bug upstream.

A refusal drops one leaf, not the row: a trailhead whose gate dates are refused
still gets its vehicle, surface and road reference.

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

## 4. Check freshness

```bash
npm run check:data-freshness
```

It reads the `data_source_freshness` view and exits non-zero when `usfs_fees`,
`usfs_bathrooms` or `usfs_roads` has gone more than 90 days without a
successful import, or has never run. A non-zero exit means step 1 is due.
`--json` prints the same assessment for a script to read.

**Between merging the roads pipeline and its first successful apply, this check
exits non-zero**, because `usfs_roads` has never run. That is the check working:
the alarm is on data the catalog is missing, not on a deployment step.

`usfs_pages` is imported and logged the same way but does not fail the check:
the page sections contribute a single leaf across the whole catalog, so an
alarm on them would be noise. The report still lists the source, marked
`[other]`, so its age is visible.
