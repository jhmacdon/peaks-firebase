# Abercrombie, Teneriffe, and Bierstadt route source packets

This is a source-only batch. It does not write to Cloud SQL, queue or run a job, import a route, review a route, or change route status. Every packet remains `ready_for_import: false`.

The work starts at pull request #198 commit `5ce1931c2589be04a915e75e7325908142caff62`, which in turn uses pull request #191 as its route-coverage base. The live catalog capture ran at `2026-09-01T05:20:11.386545Z` in one repeatable-read transaction with `transaction_read_only=on` and ended with `ROLLBACK`.

## Coverage

The read-only capture found 1,596 listed destinations, 67 with a publish-valid route, and 1,529 without one.

- This batch changes no route, so its current gain is 0.
- If the three routes in pull request #198 later pass their own guarded reviews and activate, coverage can reach 70 and the gap can fall to 1,526.
- If these three routes then pass separate guarded reviews and activate, combined coverage can reach 73 and the gap can fall to 1,523.
- These three targets hold four Peaks list memberships.

Those later counts are conditional. Source packets are not route approval.

## Frozen batch

| Destination | Trailhead | Job and current state | Pending or stale route | Candidate SHA-256 | Lists |
| --- | --- | --- | --- | --- | --- |
| Abercrombie Mountain `8x6A3Evw9623TYnj9CGa` | Abercrombie Trailhead `N9e3dSIHH2FyniDO7cbZ` | `8x6A3Evw9623TYnj9CGa`, `candidate_ready` | No new pending route. Recorded replacement `osm-route-3718820-1c24abfcc0` is superseded and invalid. | `099f6500c6d296814e706cb1186b580b9900063937f9afb7a3b35dfa4cf3e274` | Ultras `9zsS3gPZhQCiPMl0DRMf` |
| Mount Teneriffe `LAG3Glmi6mUYNr64ixDz` | Mount Teneriffe Trailhead `QyRZnRksI3wwOoqroNgn` | `LAG3Glmi6mUYNr64ixDz`, `waiting_access` | Pending `AtBCTS3AImwhrnQh3HNK`; invalid active replacement `Q4tbKTNo2sNe6Dz3SDr9` | `90db27563c1590bcb2104316325c39b41b6d5bcdf6b0a0a399e6bbb519eb0767` | Washington Home Court 100 `grDJmpZ6mtpgtFY8X7i1` |
| Mount Bierstadt `BM4y2gvTbqY6R9bGJjUl` | West Slopes Trailhead `tTqrcXqhwyekaL5tHVvd` | `BM4y2gvTbqY6R9bGJjUl`, `waiting_access` | Pending `i4PcVk0K1pOsBJMLWOCG`; invalid active replacement `4jhHhNidClxMk1MfVDHo` | `2f00bb3aa7b113256e18bc1eae5ccacefd29638cc7dd385f6176b7cb604dd8ae` | Colorado 14ers `LAZcIKjluO0oT3o9g6MC`; Traditional Colorado Centennials `82746E80A10CB7C0FBA5` |

The catalog replay includes each full candidate artifact. The test hashes `canonicalJson(candidate_artifact)` and gets the stored candidate hash for all three.

## Cover proof

The query does not expose stored image data. It records a safe `hero_image_present` flag and a `cover_complete` flag that requires nonblank image, attribution, and attribution URL fields.

All three flags are true, with these credits:

- Abercrombie Mountain: `James Jacobson / Attribution`, [Wikimedia Commons source](https://commons.wikimedia.org/wiki/File:Abercrombie_Mountain_WA.jpg)
- Mount Teneriffe: `Ron Clausen / CC BY-SA 4.0`, [Wikimedia Commons source](https://commons.wikimedia.org/wiki/File:Mount_Teneriffe_from_Middle_Fork_Snoqualmie_River.jpg)
- Mount Bierstadt: `David Herrera from Albuquerque, NM, Bernalillo / CC BY 2.0`, [Wikimedia Commons source](https://commons.wikimedia.org/wiki/File:Mount_Bierstadt,_Sawtooth,_Mount_Evans_(10579983656).jpg)

## Source and geometry gates

The replay bundle pins all 17 cited OSM `way/full.json` responses. The test builds the OSM graph from those responses and runs `reviewOsmRouteGeometry` and `reviewOsmRouteTopology`.

| Packet | OSM ways | Route points | Connectors, start / end | Core max / p95 | Core coverage | Topology and use |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Abercrombie | 4 | 173 | 18.40 m / 23.71 m | under 0.000001 m / under 0.000001 m | 100% | valid; 4 of 4 ways used |
| Teneriffe | 10 | 407 | 9.69 m / 7.26 m | under 0.000001 m / under 0.000001 m | 100% | valid; 10 of 10 ways used |
| Bierstadt | 3 | 312 | 49.32 m / 0 m | 0.49 m / under 0.000001 m | 100% | valid; 3 of 3 ways used |

Every cited OSM way is a path or track, none denies foot access, and none has an alpine or climbing `sac_scale`. The candidate endpoints match the exact stored trailhead and summit coordinates. Teneriffe and Bierstadt also have one segment, exact two-place bindings, zero stored summit gap, and passing pending-route machine integrity.

Current access proof uses short exact fragments from the cited pages, with the supported facts stated separately:

- The Forest Service trail page identifies Abercrombie #117 as a 3.2-mile trail. Its trailhead page lists round-the-clock access, and WTA describes the named trail as the main scenic summit route.
- Washington DNR now says Mount Si, Little Si, and Mount Teneriffe trails reopened to the public on June 18, 2026. This is new proof for the existing `official_access_evidence_missing` block. A later review must bind that exact DNR page; this packet does not clear the job.
- COTREX calls Bierstadt's West Slope the standard route, labels it class 2, and says Guanella Pass access is seasonal. Clear Creek County now says the pass is open for summer, may close after snow, and closes after Thanksgiving until about Memorial Day. The saved candidate's `permit_required` claim is not supported. A later guarded pass must change it to `seasonal` and cite the county page.

## Hard rejection

Mount Angeles route `jCNuGRP8FNyO8h4QuGIg`, destination `7nJmKhZy74iFjKUJqtkx`, passes pending-route machine integrity. It is still rejected. The pinned WTA page calls the summit a scramble, requires class 3 experience, and warns of a rough fall. Machine integrity does not make an exposed line a safe standard hiking route.

The batch also keeps the existing hard exclusions for High Knott, Williamson's Monument, the exposed Pillar Rock climb, DoBIH firing-range hills 2711, 2713, 2735, and 2877, and every other technical or exposed line.

## Evidence and next branch

- Packet: [fixture](fixtures/abercrombie-teneriffe-bierstadt-route-source-packets-2026-09-01.json)
- Read-only SQL: [capture query](fixtures/abercrombie-teneriffe-bierstadt-route-coverage-capture-2026-09-01.sql), SHA-256 `02dfa5791559ee42bdd0001133c9f89546ffb9edfcf3bc41cce1f48e2f84db7a`
- Replays: [base64 gzip bundle](fixtures/abercrombie-teneriffe-bierstadt-route-source-replays-2026-09-01.json), SHA-256 `b6878e6f162958366dd94c92f7f14f84809ae47f7f1c49d37977a282afe0e1d1`

The replay manifest records encoded and decoded byte counts and hashes for every item. Each official-page artifact keeps the source URL and exact original response byte count and SHA-256, but commits only a compact factual-evidence envelope. Full pages, scripts, styles, client keys, and unrelated page content are omitted. `full_response_committed` is false for all seven transformed sources. No republication permission is claimed or needed for these narrow factual excerpts. Raw headers, lease data, candidate paths, and stored image data are not present.

Any route change should start in a new worktree from the latest `origin/main` after both source-packet changes merge. A clear later branch name is `codex/import-abercrombie-teneriffe-bierstadt-standard-routes-20260901`. That later task must fetch access again, revise the two blocked access bindings, run a publish dry run, and use the existing guarded import, review, approval, and activation steps. It must not treat this packet as approval.
