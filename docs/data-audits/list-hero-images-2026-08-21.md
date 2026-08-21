# List-scoped Wikimedia hero-image backfill — 2026-08-21

`--list-id` / `--all-lists` added to
`cloud-sql/migrate/src/backfill-destination-descriptions.ts`, then run once per
curated list against prod. List membership is the curation for this branch, so
it drops the default branch's prominence floor and `'summit' = ANY(features)`
requirement — a peak on a list is worth an image whether or not it clears 300 m
of prominence or carries the summit feature tag. The branch tracks only
`hero_image IS NULL`; a list member still missing a description gets one too,
for free, the moment `planRow` resolves its article.

## What changed in the script

- `buildCandidateQuery` gained a third branch, selected via `listId`/`allLists`:
  `d.id IN (SELECT destination_id FROM list_destinations WHERE list_id = $1)`
  for one list, or the same without the `list_id` filter for `--all-lists`
  (a destination in more than one list is still selected once, since the
  membership check is a subquery rather than a join). No prominence floor, no
  summit-feature requirement, `hero_image IS NULL` unless `--force`, ordered by
  `elevation DESC`.
- `parseArgs` centralizes flag reading and combination validation, replacing
  the ad hoc `hasFlag`/`stringFlag`/`intFlag` calls that used to live directly
  in `main()`. It rejects `--dry-run` + `--commit` together (unchanged
  behavior, now routed through the same `FlagUsageError` path as every other
  bad combination), `--list-id` + `--all-lists` together, and either of those
  with `--ids` (an exact id list makes a list scope redundant).
- Everything else — the licensing gate (`isFreeLicense`), the attribution
  format, `namesMatch`, the wikidata coordinate anchor, the 350 ms politeness
  delay, dry-run-by-default — is untouched.
- TDD: 14 new tests (buildCandidateQuery's new branch, both flags' outputs and
  defaults, all four rejected combinations, plus a fix-round-1 pass adding a
  blank `--list-id` rejection and an unrecognized-flag rejection) landed red,
  then green. Full suite: 676 pass, 0 fail (was 662 before this task).
  `parseArgs` also refuses any unrecognized `--flag` outright (a typo like
  `--all-list` used to be silently ignored) and refuses a blank/whitespace-only
  `--list-id` value, which previously fell through to the whole-catalog
  default branch — see "Fix round 1" below.

## Bulger List dry-run (sanity check before any commit)

`--list-id DOlya3YYfIg60trgTm0n --dry-run --limit 100`: 92 candidates,
written=74 (images=71), unmatched=18, imagesRefused=0. Match rate ~80%, image
hit rate ~77%. The misses are the hard Bulger case doing its job, not a
`namesMatch` failure: title-convention mismatches Wikipedia keeps under a
different name ("Little Tahoma" → "Little Tahoma Peak"), one wikidata sitelink
correctly rejected as 5.8 km off the catalog coordinate (`Remmel Mountain`),
and genuine no-article cases for minor summits. Healthy — proceeded to commit
runs.

## Per-list commit runs

`--list-id <id> --commit --limit 150`, one list at a time, run sequentially
(never parallel — the 350 ms delay and four-request sequence per candidate are
load-bearing for Wikimedia's courtesy limits). All 17 exited 0, no FETCH
warnings, no thrown errors.

| List | candidates | written | images | refused | unmatched |
|---|---:|---:|---:|---:|---:|
| Bulger List | 92 | 74 | 71 | 0 | 18 |
| California Fourteeners | 13 | 11 | 11 | 0 | 2 |
| Cascade Volcanoes | 9 | 7 | 7 | 0 | 2 |
| Colorado 14ers | 52 | 48 | 48 | 0 | 4 |
| Mazama Guardian Peaks | 0 | 0 | 0 | 0 | 0 |
| Nevada Peaks Club | 72 | 47 | 33 | 0 | 25 |
| Oregon Volcanoes | 0 | 0 | 0 | 0 | 0 |
| Sierra Peaks Section Emblem Peaks | 11 | 11 | 11 | 0 | 0 |
| Smoot's 100 | 69 | 61 | 60 | 1 | 8 |
| Tennessee 4500ft Peaks | 55 | 13 | 12 | 0 | 42 |
| The Seven Summits | 2 | 0 | 0 | 0 | 2 |
| Ultras of Iran | 51 | 5 | 5 | 0 | 46 |
| Ultras of the Contiguous United States | 32 | 28 | 26 | 1 | 4 |
| US State High Points | 37 | 31 | 31 | 0 | 6 |
| Utah 13ers | 18 | 7 | 6 | 0 | 11 |
| Washington Home Court 100 | 82 | 30 | 28 | 0 | 52 |
| Washington State Volcanoes | 0 | 0 | 0 | 0 | 0 |
| **Total** | **595** | **373** | **349** | **2** | **222** |

Notes:
- **Mazama Guardian Peaks**, **Oregon Volcanoes**, and **Washington State
  Volcanoes** show 0 candidates because every member of those three small
  lists already had a `hero_image` (Cascade/Washington volcanoes are
  well-photographed, high-traffic Wikipedia subjects). Not a bug — the
  candidate query is working as intended.
- **Ultras of Iran** (5/51) and **Tennessee 4500ft Peaks** (13/55) have low hit
  rates because most members are minor, rarely-documented summits with no
  standalone Wikipedia article — `namesMatch` and the wikidata anchor are
  doing their job rejecting non-matches rather than failing to find real ones.
- **Nevada Peaks Club** (72 candidates, 47 written, only 33 with an image) is
  the one list where description hits outran image hits by a wide margin —
  consistent with remote Nevada desert peaks having thinner Commons photo
  coverage than prose coverage.
- Both licensing refusals are correct outcomes, not failures:
  - Smoot's 100 / Mount Forgotten (`EIkdq9LHLzn81uC2VsZe`) — imageinfo
    returned no readable credit for `File:Mount_Forgotten.jpg`; description
    still landed.
  - Ultras of the Contiguous US / Abercrombie Mountain (`8x6A3Evw9623TYnj9CGa`)
    — Commons licence string was the bare word `"Attribution"`, which does not
    match the free-licence allow-list (`cc by`/`cc0`/`cc-by`/`public domain`/
    `pd`); treated as non-free rather than assumed to be CC BY. Description
    still landed, no orphaned attribution.
- No row in this run's 373 writes has an image without complete attribution or
  attribution without an image — `writeRow`'s guards held for every write
  (`349` images, `349` complete attributions, `0` gaps).

### Reconciling 595 against the 626-member catalog

The **595** in the total row is a sum of **per-list** candidate counts, not a
count of distinct destinations — a destination on more than one curated list
is a candidate once per list it belongs to (until an earlier list's run gives
it an image, after which later runs correctly skip it). The distinct baseline
is **588**: `626` list members minus the `38` that already had a `hero_image`
before this task ran.

```text
595 (sum of "candidate destination(s)" across all 17 log files)
- 588 (distinct destination ids among those same candidate-appearance rows)
= 7 extra appearances, from 6 destinations that are members of 2+ lists
```

Verified by parsing every list's `WRITE`/`MISS` row ids out of the run logs
(candidates always resolve to one or the other; no list showed a `skipped`
count above 0) and counting duplicates:

```bash
# one row per (destination id, list) candidate appearance, from the run logs
grep -E "^  (WRITE|MISS)" *.log | awk '{print $2}' > candidate-ids.txt
wc -l candidate-ids.txt                    # 595
sort -u candidate-ids.txt | wc -l          # 588
sort candidate-ids.txt | uniq -c | awk '$1>1'   # the 6 overlapping ids, 7 extra appearances
```

The six overlapping destinations: `3Lk48tEzKFWOGtKDqEGd` (Little Tahoma —
Bulger List, Cascade Volcanoes, Smoot's 100: 3 appearances, 2 extra),
`7El4sAemtdwIHZzt1YxJ` (Mount Buckner), `APWWTYFkwvuUFc3TP1m9` (Sahale Peak)
— both Bulger List + Smoot's 100 — `fC9zpl4WpEUZvU4HTsSI` (Clingmans Dome —
Tennessee 4500ft Peaks + US State High Points), and
`KLeNLAdXik6q0Nc8AW54` (Hayford Peak), `nTJtNPdIX5emLtQtsOGQ` (Charleston
Peak) — both Nevada Peaks Club + Ultras of the Contiguous United States. Every
one of the five title-mismatch/no-match peaks stayed a `MISS` in both lists —
consistent, not a second independent failure. Hayford Peak is the interesting
case: Nevada Peaks Club wrote its description (the article has no lead image,
so `hero_image` stayed `NULL`), which correctly left it eligible again under
Ultras of the Contiguous United States — that second pass tried an image-only
recovery and, correctly, found nothing new to store. No destination was
written twice.

**Are the 373 written rows 373 distinct destinations? Yes**, confirmed two
ways:

1. Raw `WRITE` line count across all 17 logs equals the count after
   deduplicating by id — both **373** — so no id was ever the subject of a
   `WRITE` twice.
   ```bash
   grep -c "^  WRITE" *.log | awk -F: '{s+=$2} END{print s}'   # 373
   sort -u written-ids.txt | wc -l                              # 373
   ```
2. Cross-checked directly against prod, independent of the log parsing:
   ```sql
   SELECT count(*), count(DISTINCT id) FROM destinations WHERE id = ANY($1::text[]);
   -- $1 = the 373 ids from written-ids.txt → 373 | 373
   ```

## Spot-checks

10 random rows from the 373 this run wrote (not from the wider list-member
pool — see below): 9 of 10 landed an image with complete
(`hero_image_attribution` + `hero_image_attribution_url`) credit; the tenth,
Abercrombie Mountain, correctly has no image at all (the licensing refusal
above) and no orphaned attribution fields either. Sampled: Mount Muir, Tupshin
Peak, Britton Hill, Chiwawa Mountain, Silers Bald, Campbell Hill, Mount Nebo,
Saska Peak, Vesper Peak, plus Abercrombie Mountain.

`/destinations/{id}` pages were not loaded in a browser for this check — the
SQL check above (both attribution columns non-null whenever `hero_image` is
non-null) is the stronger guarantee, since it is a total check over all 373
writes rather than a 10-row sample, and it is what `writeRow`'s guard clauses
actually enforce.

## Pre-existing data-quality note (out of scope for this task)

The first spot-check sample happened to include **Mount Whitney**
(`Ta8deqYutGWWgheXfg4q`), which has `hero_image` set but both attribution
columns empty. It predates this task entirely — `updated_at` is
2026-07-25, three weeks before this run, and it was never a candidate here
(the query only selects `hero_image IS NULL` rows, and Mount Whitney already
had one). `writeRow`'s guard — refuse a hero image with incomplete attribution
— cannot have produced this row; it must have been written by an earlier
import path that predates the guard, or written directly.

Quantified: **27** list-member destinations across the whole catalog carry
this same gap (`hero_image` set, attribution incomplete), all outside the 373
rows this task wrote. Flagging for a later backfill/cleanup task — not fixed
here, since editing rows this run didn't touch is out of scope for a
list-scoped hero-image backfill.

## Coverage

| | hero_image set | of list members | 
|---|---:|---:|
| Before (2026-08-21, pre-run) | 38 | 626 |
| After (2026-08-21, post-run) | 387 | 626 |

Net gain: 349 destinations, matching the sum of `images` across all 17 runs
exactly (38 + 349 = 387).

```sql
SELECT count(*) FILTER (WHERE d.hero_image IS NOT NULL), count(*)
FROM (SELECT DISTINCT ld.destination_id FROM list_destinations ld) x
JOIN destinations d ON d.id = x.destination_id;
```

## Deferred

Brief Step 5 (`--all-lists --commit` re-run after new list imports) belongs to
a later task in the lists-overhaul sequence — the flag is implemented and
tested now, but not exercised as `--all-lists` in this run; every list was run
individually instead so per-list counts could be recorded.

**Warning for that future run:** `--all-lists` inherits `parseArgs`'s default
`limit: 100` exactly like every other invocation — pass an explicit `--limit`
sized to the remaining candidate count (distinct list members still missing a
`hero_image` at that time), or the run will silently cap at 100 candidates
and stop, the same way `--list-id` does today. The script docblock now says
the same thing next to the `--all-lists` flag description.

## Fix round 1 (post-review)

Two Important findings and one controller ruling from the first review pass:

1. **Blank `--list-id` silently ran the whole-catalog default branch.**
   `parseArgs` only truthy-tested `listId`, so `--list-id "$UNSET_VAR"` (a
   quoted, unset shell variable resolves to an empty string, not a missing
   argument) parsed as `listId = ""`, which is falsy — the `options.listId ||
   options.allLists` branch check in `buildCandidateQuery` never fired, and
   the run silently fell through to the prominence-ordered, catalog-wide
   default, writing up to `--limit` rows with no indication the list scope
   was never applied. Fixed: `parseArgs` now trims the value and throws
   `FlagUsageError` when it is empty. Same class of bug, same fix: an
   unrecognized `--flag` (a typo like `--all-list`) used to be silently
   ignored; `parseArgs` now refuses any `--token` not in its known-flags set.
   Two new tests (`parseArgs rejects a blank --list-id value...`, `parseArgs
   rejects a whitespace-only --list-id value`, `parseArgs rejects an
   unrecognized flag`) — three tests, all `FlagUsageError`. Full suite: 676
   pass, 0 fail.
2. **Candidate-count reconciliation** — the "Reconciling 595 against the
   626-member catalog" section above, and the "Are the 373 written rows 373
   distinct destinations?" check, both added in this round.
3. **Default-limit warning** — added to the Deferred section immediately
   above and to the script's docblock next to `--all-lists`.

No prod re-runs were needed for this round — all three findings were
documentation/validation gaps, not data-integrity problems in the rows
already committed.

Monthly cost impact: $0.
