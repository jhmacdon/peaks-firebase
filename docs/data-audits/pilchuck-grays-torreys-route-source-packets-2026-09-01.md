# Pilchuck, Grays, and Torreys route source packets

Date: 2026-09-01

Base: PR #191, `848fabe210b98c8ed4aeeb2e48906a212ef1a1fa` on `codex/maintain-active-route-cover-invariant-20260901`

## Result

This batch pins source and catalog evidence for three separate out-and-back routes:

- Mount Pilchuck via Mount Pilchuck Trail #700
- Grays Peak via North Slopes
- Torreys Peak via Grays Peak Trail and Grays/Torreys Connector

It is source-only. It has no import or apply command, performs no database write, queues no job, and does not approve or activate a route. Every packet has `ready_for_import: false`.

An exact read-only capture at 2026-09-01 04:39:03.565080Z found 67 publish-valid listed destinations out of 1,596 and no publish-valid route for any of the three target summits. This batch changes neither count. A later, separate review and activation could add three destinations across the five captured list memberships, raising the publish-valid count to 70 and lowering the missing count from 1,529 to 1,526.

## Durable evidence

The fixture is [pilchuck-grays-torreys-route-source-packets-2026-09-01.json](fixtures/pilchuck-grays-torreys-route-source-packets-2026-09-01.json). Its replay manifest pins each raw response and deterministic `gzip -n -9` file by byte count and SHA-256 hash. The test decompresses every file, checks both hashes and byte counts, and parses the facts used below.

The coverage proof comes from [pilchuck-grays-torreys-route-coverage-capture-2026-09-01.sql](fixtures/pilchuck-grays-torreys-route-coverage-capture-2026-09-01.sql), 5,573 bytes with SHA-256 `8a23c39af84b974b1bd7bb6faddae2e9ec75918bf18a7f3b7e9926a1ea93b460`. The query starts a repeatable-read `READ ONLY` transaction, records `current_setting('transaction_read_only')`, calls `peaks_route_passes_publish_integrity`, selects only safe fields, and rolls back. Its exact output proves the 1,596/67/1,529 counts, three false target pass flags, five memberships, nine target routes, and three jobs.

| Replay | Fetched at | Raw SHA-256 | Gzip SHA-256 |
| --- | --- | --- | --- |
| Pilchuck OSM way 37583693 | 2026-09-01 03:13:56Z | `2568c522d769feaf49bea8bae64e6e6805a6e822266c645af5af0081ac4507c2` | `ab07144063da96f17b2ef7500ad772f5db16b393918bf0ef308230704b89620b` |
| Trail NFS Pilchuck Trail 700 | 2026-09-01 03:14:50Z | `14ac41cdeeffb991f0d58946269c8e57987de25d5233e23fe92722b5fd69e0a8` | `0a6f7f49f7ddecc436f1eda688889d385e11b805d44b85ddd4ba6ba67cc1e185` |
| Retired Pilchuck brochure 404 | 2026-09-01 03:15:23Z | `0681fc81fcfd6633e09dbd65771d921f75028681fb29d98085c83f65da081f48` | `6b93f30e05d114fcb1c7361b7b4d8849c61a41b8d9eee211b324c906ec44a9fd` |
| Grays USGS objects 2532973 and 2540103 | 2026-09-01 04:08:40Z | `01140003da14072d3c57fc1fbb0893970ccefdf7fbe1c55b4d33cc648bf700a5` | `808c5eaa3a8852120349660820b43ffacde94ac6c1f3a1f4dcbe8339ae8aaed8` |
| Torreys USGS objects 2518708, 2540103, and 2555256 | 2026-09-01 04:08:40Z | `f8c4fa2878d289d9c8a873c0c2f2751270a813ca30ae9fbc4ddebaab3484ea9d` | `73161e28e2bc4bc4e9b125a1f6883bf45917e975ca38e9971c82c21f1636c4d4` |
| Direct USFS Grays Peak Trailhead page | 2026-09-01 03:54:33Z | `a168546f5fea32932bd7e1ca2cf017ab2150d263e03d1e9a580fcc83fdd11248` | `b1ec368f96f6f814b2d3f30f7e75ded0ddc0dfdeffdb15797d4e0cf57f2866db` |
| Direct USFS Grays Peak Trail page | 2026-09-01 03:55:00Z | `60d6d05141285b1fd3640b926e8f7820a3449f00b69393071e3629e04f04200d` | `36244a199eb6d67b9a4a25bc3afe75854c83ece297da0339d52bad45ec39c5e6` |
| Read-only catalog and job snapshot | 2026-09-01 04:06:54.569283Z | `ecdbdca927403de2f6ab75dfa04901b9ee873dbd82887774b21df4238011f1f8` | `32e2b894453abf9df7c93430d8ac463c63712578a7b4988e7269bbe50fc7a4e7` |
| Read-only route coverage proof | 2026-09-01 04:39:03.565080Z | `88d17001643e7494c75d96fb62f932e0c35e714c04f744c42e2401e0ab95c62e` | `41276238065a19074c38562e10bc06bf1c41e970999e4254f229f86ecfa7a07a` |

The compact catalog snapshot records `transaction_read_only: "on"`. It contains five destinations, five list memberships, nine routes, and three route jobs. It omits lease owner, lease token, lease expiry, candidate path, candidate artifact, and hero image fields. A scan found no credential or session values in the selected replay files. HTTP headers are not part of the replay bundle.

## Mount Pilchuck

The packet pins the existing pending route, approved job row, saved candidate hash, and selected OSM way 37583693. The OSM replay proves that the way is named `Mount Pilchuck Trail #700`, is tagged for designated foot use, and has 237 pinned vertices. The Trail NFS replay independently identifies `PILCHUCK LOOKOUT`, trail number `700`, year-round managed pedestrian use, and 635 pinned vertices.

The packet does not contain the candidate, path, or prior review bytes. It does not replay or prove the earlier geometry review. Later work must rerun the full geometry and source review.

The retired USFS brochure URL now returns HTTP 404. The packet preserves that exact response only to prove that it is unavailable; it does not rely on the page.

The saved job error remains a rerun-only condition: `Publish dry run failed again: PostgreSQL statement timeout 57014 in findCandidateSegments`. It does not invalidate the source packet, but a later write task must run a fresh publish dry run before import or activation.

## Grays Peak

The Grays route uses only USGS objects 2540103 and 2532973. The source URL cites only those two objects. The path builder must use:

1. the exact catalog trailhead point;
2. object 2540103 forward;
3. one repeated endpoint for the builder's explicit zero-distance source-join edge;
4. object 2532973 forward, with its first point supplied by that join edge;
5. the exact catalog Grays summit point.

The builder-parity path has 818 points, matching the captured pending route's point count. Its one zero-length source-join segment has index 562. The path is 5,912.0186918 metres long and has coordinate hash `17bce27438e05e7f27b9a61feddab4631077dee2b828caec0e13d5f1ee266bb3`. The real `reviewOfficialRouteGeometry` check finds both source objects used, no unused objects, valid source topology, 100% core coverage, and 0-metre trailhead and summit contact from the built path. The physical endpoint connectors are 16.237125278951517 and 33.45736263641486 metres.

## Torreys Peak

The Torreys route uses only USGS objects 2540103, 2555256, and 2518708. The source URL cites only those three objects. The path builder must use:

1. the exact catalog trailhead point;
2. object 2540103 forward;
3. one repeated endpoint for the first explicit zero-distance source-join edge;
4. object 2555256 in reverse, with its first point supplied by that join edge;
5. one repeated endpoint for the second explicit zero-distance source-join edge;
6. object 2518708 forward, with its first point supplied by that join edge;
7. the exact catalog Torreys summit point.

The builder-parity path has 895 points, with zero-length source-join segments at indexes 562 and 703. It is 5,893.5923287 metres long and has coordinate hash `f91cdb6df46870580855a2a5e26b738a949481efaa14b01cf133a9576b41c151`. The real reviewer finds all three source objects used, no unused objects, valid source topology, 99.94391475042065% core coverage, and 0-metre trailhead and summit contact from the built path.

The final source-to-summit join is 4.44304051642236 metres from the source. That is only about 0.56 metres inside the reviewer's 5-metre limit. Keep every source decimal. Do not replace the endpoint-only assembly with `buildOfficialRoutePath`; its interior cuts fail the Torreys topology check.

## Official access facts and limits

The direct Forest Service trailhead page says the trailhead provides access to Grays Peak Trail #54 and Torreys. It says the area is generally not snow-free until late June or even July in some years, that the road is usually not plowed, that early or late trips may need to start at I-70, and that the rough road may require four-wheel drive at times and is impassable in winter.

The direct trail page says the trail starts at Grays Peak Trailhead and offers a chance to summit Grays and Torreys in one day. It labels the route `Standard/Terra Trail`; it does not give a climbing grade. These packets make no stronger access or grade claim.

## Review limits

Kelso Ridge, Grays Peak Kelso Ridge, Dead Dog Couloir, and every technical or exposed climbing alternative are hard exclusions. The current Torreys job points at a banned technical replacement route, so a later write task must fix that guarded binding before import.

Any later implementation must review current access, keep one route-specific USGS URL per route, rebuild each path from the replay bytes, rerun the real geometry reviewer, run the publish dry run, and gain separate approval before import or activation.
