# Fire lookouts — September 7, 2026

The production catalog now marks **251 peaks** and **10 standalone lookout records**
with `fire-lookout`. This pass added the tag to 250 peaks, corrected seven legacy
tags, and saved evidence on all 268 affected records. It scanned all 83,450
Peaks-owned destinations, including 42,019 summit records. No destination was
created, deleted, renamed, or moved.

The feature means a surviving fire lookout or restored fire tower associated
with the place. It does not promise staffing, public access, an enclosed cab, or
a tower on the mountain's highest point. Twelve reviewed links cover a lookout
on the same named mountain or ridge away from the catalog high point; their
evidence keeps the actual tower coordinates and distance.

## Sources and coverage

- [Forest Fire Lookout Association](https://firelookout.org/lookouts/us/): all
  31 linked state inventories checked. The source files contain 1,314 original
  structures with exact `Standing` status and coordinates, plus four rebuilt
  or private-access structures reviewed separately. One damaged Escudilla
  record was held out. Relocated museums, non-lookout structures, and ruins
  were excluded from new automatic matches.
- [OpenStreetMap](https://www.openstreetmap.org/copyright): 1,352 worldwide
  records from explicit fire-lookout tags, plus 3,319 US observation towers.
  Fire-specific classification and deduplication yielded 1,577 sources; current
  evidence rejected three stale records. Attribution: © OpenStreetMap
  contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
- Land managers, preservation groups, and documented field visits resolved
  names, structures below summits, and conflicting status reports. Each manual
  decision links its evidence in the JSON files.

`sources.json` contains 2,891 positive source records. OSM represents buildings,
towers, and nodes separately, and some overlap FFLA entries; this is not a count
of unique lookouts. Matching retains corroborating sources.

Inventories are incomplete. Nineteen US states have no linked FFLA inventory;
one standing Texas lookout with private coordinates could not be matched. FFLA's
Canada and Australia inventories are under construction. Global OSM supplies
the non-US coverage here. An unmarked peak means **unverified**, not that a lookout
is absent. See `coverage.json` for the full limits and counts.

## Match and audit rules

Automatic matches require a `summit`, `volcano`, or existing `fire-lookout`
feature and either coordinates within 100 m, or an exact normalized name within
500 m. A reviewed place link names an exact destination ID, cites its reason,
and stays within 2 km. Distance alone never links neighboring peaks.

One source matches two records: Mount Adams and its standalone lookout. Both
describe the same place and keep their own IDs. All other source matches point
to one catalog destination.

The legacy audit removed six former or destroyed lookout tags and changed
Cobble Lookout to `viewpoint`. It kept documented surviving structures,
including the relocated Lorena cabin and Leecher's historic tree platform.
Mebee Pass Lookout's existing coordinates need a separate review; this pass
left them unchanged and records that limit in its evidence.

The status review rejected stale OSM records for Keller Peak, Aeneas Mountain,
and Slate Peak. It retained the rebuilt High Rock cabin and Mount Kineo's
restored viewing tower. High Rock's evidence records its current access closure.

## Files

- `sources.json`: positive source facts, coordinates, credits, and reviewed links.
- `marked-destinations.json`: the final 261-record roster, IDs, and match distances.
- `legacy-audit.json`: decisions for the 14 legacy records missed by OSM.
- `source-conflicts.json`: five conflicting status reports and their resolution.
- `osm-near-miss-review.json` and `ffla-near-miss-review.json`: reviewed links and
  nearby places left unlinked.
- `coverage.json`: scope, source limits, and production verification counts.

## Repeat the reviewed repair

Run from `cloud-sql/migrate` with the normal `DB_*` variables supplied securely.
These files capture a dated review; fetch and review fresh evidence before using
them for a future discovery pass.

```sh
npm run backfill:fire-lookouts -- \
  --input=data/fire-lookouts-2026-09-07/sources.json \
  --audit=data/fire-lookouts-2026-09-07/legacy-audit.json \
  --verified-on=2026-09-07 --report=/tmp/lookout-review.json
```

The default is read-only. Inspect the report, including shared sources and
unmatched records. Apply requires both `--expected-count` and `--expected-digest`
from that exact review, plus `--apply`; use a separate report path. Changes to the
matched IDs or recorded evidence invalidate the digest. `--catalog` supports an offline dry run
and cannot be used with `--apply`.

The writer locks each target, checks its name, coordinates and feature array,
appends the feature, and writes `metadata.fire_lookout`. It keeps all other
metadata keys and features. A transaction rolls back every change on a failed
check. Exact repeat runs skip unchanged rows. Readback verified all 268 target
rows against their saved before-values, including preserved fields and evidence.

## Checks and cost

Migration TypeScript build and eight focused tests passed, including an offline
CLI check for reviewed links beyond the automatic radius. Web build, lint,
26 focused tests, and desktop/mobile browser checks passed. iOS build, 18 focused
tests, and the 286-test CI selection passed locally in
[Peaks-iOS #262](https://github.com/jhmacdon/Peaks-iOS/pull/262).

This uses the existing feature enum, metadata field, API responses, and web
queries. No infrastructure change or recurring job: **$0/month added run-rate**.
