# Production trail label repairs — 2026-10-28

Applied label corrections to 2,989 distinct segments after Josiah authorized production repair,
starting with Three Fingers. The segments serve 2,973 active routes, 86 pending
routes, and seven superseded catalog routes. Every shared link was checked; no
private route links were changed.

The [original audit](https://github.com/jhmacdon/peaks-firebase/pull/260) covered
19,169 active or pending catalog routes. Its 4,545 flagged routes were review
candidates, not 4,545 proven naming errors. The glacier-source importer fix remains in that PR. This record covers the reviewed
production repairs and preserves identifying numbers in compact network codes such as
`Buf-#22-Easy` during future name cleanup.

A [fresh production scan](after-audit-summary.json) again covered all 19,169
active or pending routes. It found no adjacent spelling variants, no remaining equivalent-name candidates,
and no ice rows using path names. The remaining 14 ice-as-trail flags are the two documented Dewey
Point winter routes reused across catalog routes. All remaining flags, including
the distinct-name and terrain-transition cases, have a decision in
[review-outcomes.jsonl](review-outcomes.jsonl). This is a new database snapshot,
not a replay of expected changes.

| Batch | Segment labels | Change |
| --- | ---: | --- |
| Three Fingers | 8 | One Trail #641 approach name, distinct summit and ridge labels, and two descriptive ice-crossing labels |
| Equivalent names | 976 | Consolidate adjacent variants that differ by case, punctuation, a Trail suffix, or a shared route designation |
| Mapped ice | 32 | Use polygon names where every stored edge midpoint has source coverage; use a crossing description for unnamed polygons |
| Grays Peak and Salmon Summit | 4 | Use source-backed trail names; remove the unsupported Salmon Summit scenic designation |
| St. Mary's | 1 | Use the mapped geographic name and correct glacier to snowfield from local sources |
| Complete stretches | 1,956 | Extend equivalent names through all inner segments, not just the boundary IDs listed by the audit |
| Buffalo Mountain | 18 | Restore source trail numbers and mark source segments without numbers as unnumbered |

The batches contain 2,995 label writes to 2,989 distinct segments; six labels were
aligned again when complete stretches joined earlier boundary groups. Two malformed
Buffalo Mountain loop titles also changed to distinct names based on their numbered
trails. Their geometry, statistics, aliases, status, and stable URL slugs did not change.

Three Fingers now has six named stretches: **Three Fingers Trail #641**, **Summit
Approach**, **Lower Ice Crossing**, **Ridge Traverse**, **Summit Ice Crossing**, and
**Summit block and ladders**. The existing iOS presentation joins adjacent segments
with the same name and kind. All geometry, distances, source aliases, and terrain
types on this route stayed unchanged. The ice labels are descriptions, not invented
glacier names. [WTA](https://www.wta.org/go-hiking/hikes/three-fingers),
[The Mountaineers](https://www.mountaineers.org/activities/routes-places/three-fingers-south),
and the [Forest Service trail list](https://www.fs.usda.gov/Internet/FSE_DOCUMENTS/fseprd530006.pdf)
support the trail identity and approach sequence. The linked original audit records
the unnamed source polygons crossed by the stored route.

For St. Mary's, [Clear Creek County](https://www.clearcreekcounty.org/st-marys-glacier/)
and the [Colorado Mountain Club](https://www.cmc.org/education-adventure/trips/routes-places/st-marys-glacier)
identify a semi-permanent snowfield. The feature keeps its mapped name, **Saint
Mary's Glacier**, with kind `snowfield`. Refreshing its 12 linked routes removed the
glacier-only mountaineering category. Their difficulty ratings, geometry, statistics,
and existing snow-travel warnings stayed unchanged. This describes the feature's
type, not today's snow cover. The decision also lives in `segment_terrain_labels`.

The review leaves these limits visible:

- Nineteen unnamed ice segments on seven routes still need terrain or source coverage
  review: Easton, Squak, Park, Sahale, Rainier via Emmons, Glacier Peak via North Fork
  Sauk, and Mont Blanc via Goûter. Several are small legacy connectors or cross the
  edge of source polygons. This review has no French glacier polygons. Assigning a
  nearby glacier's name would hide the uncertainty. See [the worklist](ice-needs-review.json).
- Ninety-three catalog routes had no stored segments. They need geometry and link
  repair before a stretch-name audit can pass them. No labels or terrain were invented.
- Different trail names sometimes share an alias. That does not justify merging
  them. A named route can also cross several terrain types; those transitions stay
  visible. The review retains these flags with an explicit decision.
- Dewey Point Meadow and Ridge are named winter routes, as
  [NPS documents](https://www.nps.gov/yose/planyourvisit/trailheads.htm). Their source
  names and snowfield kinds remain. See [the exception](accepted-winter-routes.json).

The Buffalo Mountain case is distinct from a spelling variant: its source aliases
still held trail numbers while the cleaner reduced each title to `Buf-`. The
[trail authority](https://trailsheaven.com/plan-your-trip/choose-a-trail/buffalo-mountain/)
confirms the network identity. The repair restores each source number, and the code
fix keeps compact coded trail identities intact. It does not guess numbers for the
three source segments that omit them.

Cloud SQL backup **1793170232146** completed successfully at **2026-10-28 06:51:43 UTC**
before the first write. Each numbered JSON plan records the old value, replacement,
source evidence, stable row hash, and every shared route link. Its receipt records
the committed result. `05-st-marys.sql` is a separate guarded terrain correction;
it aborts if the reviewed segment or its links have changed.

[Post-commit verification](post-commit-verification.json) reread all 2,989 targets.
All labels and links matched; all 2,988 label-only changes retained their full
non-label row hash. The St. Mary's transaction checked its preserved fields and all
linked route geometry, statistics, and summaries. [Live API checks](live-api-verification.json)
confirmed Three Fingers, St. Mary's, and both Buffalo Mountain loops. The source-polygon evidence is in
[ice-source-review-with-ids.json](ice-source-review-with-ids.json), with the public
stored lines in [ice-paths.jsonl](ice-paths.jsonl). OSM data: © OpenStreetMap
contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

Validation passed: TypeScript build, focused strict typecheck, three repair tests
including isolated PostgreSQL rollback and drift checks, 177 discovery and whole-stretch
tests, 50 terrain tests, Python
syntax check, and repository cross-reference checks. Database tests used temporary
fixtures in `peaks_test`, never production tables. No app release or infrastructure
change was needed. Recurring compute impact: **$0/month**; the one backup uses the
existing Cloud SQL backup-storage settings.

See [the repair tool guide](../../trail-label-repairs.md) for preview, apply, readback,
and repeat-run behavior. Do not treat the remaining terrain and geometry work as a
clean audit result.
