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
- TDD: 11 new tests (buildCandidateQuery's new branch, both flags' outputs and
  defaults, all four rejected combinations) landed red, then green. Full suite:
  673 pass, 0 fail (was 662 before this task).

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

Monthly cost impact: $0.
