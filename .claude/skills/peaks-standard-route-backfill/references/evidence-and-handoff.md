# Route Evidence and Handoff

## Evidence grades

- **A — ready for geometry search:** Current Cloud SQL gap; a strong source names or clearly describes the normal route; access and grade match; no competing normal line found.
- **B — useful candidate:** Current gap and likely normal route, but the route name is inferred, the main source is community-run, or a second source is still needed.
- **C — research only:** Current gap, but sources conflict, access is unclear, or the available page covers a harder variation rather than the normal ascent.
- **Reject:** Cloud SQL now has an active Peaks-owned route, list membership is absent, or the peak/source match is uncertain.

Do not raise a grade because a GPX is easy to download. Geometry availability and route identity are separate checks.

## Source order

1. NPS, USFS, state land manager, or a climbing-ranger report
2. The Mountaineers route/place page
3. Washington Trails Association for trailhead and approach
4. Established guide pages, SummitPost, Peakbagger, or detailed trip reports

Use a direct page, not a search result. Note the date when road, permit, closure, glacier, or snow details can change.

## Required research fields

For each candidate, record:

- `destination_id`
- exact Peaks destination name
- current list ids and names
- Cloud SQL gap check time
- proposed Peaks route name
- source route name
- activity type: hike, scramble, glacier climb, alpine rock, or other
- grade/class if stated
- trailhead or access road
- short approach clue
- season, permit, and access caveats
- existing user route ids, names, and session counts, if any
- direct source URLs
- evidence grade and one-line reason

## Standard report

```text
Audit: <timestamp>; state/list filter; active Peaks route predicate.

Coverage:
<list>: <with route>/<total>, <missing> missing

Confirmed batch:
| Peaks id | Peak | Lists | Proposed route | Grade/type | Access | Evidence | Sources |

Deferred:
| Peaks id | Peak | Reason |
```

## Research prompts for agents

Give agents current candidate rows, not the expected answer. A useful prompt is:

```text
Research a high-confidence normal ascent for these current Peaks Cloud SQL
gaps. Work read-only. For each id, confirm the peak and list names from the
provided rows; find direct sources for route name, grade/type, trailhead, and
approach; flag competing normal routes. Do not use Firestore to decide whether
the route is missing. Return citations and separate confirmed from disputed.
```

Split batches by geography or name range. Recheck all returned ids in Cloud SQL before merging agent results.
