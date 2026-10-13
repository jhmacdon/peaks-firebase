# Washington Cascades pilot source review — 2026-10-13

This review includes all 21 requested routes. The latest offline replay admits seven source graphs and rejects fourteen. Four of the seven pass the saved elevation checks. Colchuck Lake and Lake Stuart still lack a stated gain basis in the official comparison source; Naches Peak Loop exceeds the official gain by 72.46%. **The offline replay alone does not establish readiness for pending insertion or publication.** No database connection, route write, audit-row write, or activation ran in this replay.

The earlier [production dry run](production-dry-run.jsonl) found four candidates
ready for the pending-write step, with no routes written. This is not approval
to publish. The [golden-set report](golden-set-report.json) records all 21
names and kinds, available source metrics, current catalog metrics and segment
IDs, common-name search ranks, missing covers, and unresolved fields. The
golden set does not pass, and scale-up has not started.

[Production search evidence](production-search.json) retains two initial
timeouts and a successful repeat of all five slow queries. The API returned
the existing catalog routes; it did not return missing lake or loop routes.
A concurrent segment query hit its 30-second limit. The importer now uses a
bounded indexed candidate scan and narrows duplicate checks to indexed place
references. A later read-only segment plan found 13 new spans for Serene,
four for Ingalls Lake, and four for Lake 22. Snow Lake requires a reviewed
split of an existing segment. Zero reused spans is a plan result, not permission
to duplicate older source geometry; the write path also checks source overlap.
The final probe on `peaks-api-00267-z6s` returned HTTP 200 for all 23 catalog
queries and both geographic destination-search variants. This confirms the
deployed API works; missing golden route rows still prevent the pilot passing.

[Summit impact checks](summit-coordinate-impact.txt) show that moving Mount Si
to its matching OSM point would break the active route's 5 m summit contact.
Moving Pilchuck would break the pending route's endpoint contact. Keep these
repairs coupled to reviewed route geometry. [Trailhead identity checks](trailhead-identity-preflight.txt)
also found a southern Tipsoo entrance distinct from the proposed northern
entrance. Those read-only checks changed no production places. The operator then inserted the reviewed Skyline and northern Tipsoo trailheads (audit 102). The [fresh catalog snapshot](catalog-snapshot-6bb7916bb071.txt) confirms all 32 place IDs bound by the 21-candidate manifest.

The [manifest](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest.json) fixes the selected OSM relation, source vertices, route kind, and catalog bindings. [Source evidence](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/source-evidence.json) records the request URL, retrieval time, and SHA-256 for each saved source response. USFS alternatives remain in the evidence; this pilot selects OSM geometry only. WTA pages supply name and endpoint research, not geometry or publication statistics. Their reported statistics remain in [research-only-stats.json](research-only-stats.json).

| Route | Offline result | Unresolved issue |
| --- | --- | --- |
| Lake Serene Trail | Graph and elevation pass | Access review, credited objective cover, endpoint review, live catalog checks |
| Snow Lake Trail (Alpental) | Graph and elevation pass | Access review, credited objective cover, endpoint review, live catalog checks |
| Ingalls Lake via Ingalls Way | Graph and elevation pass | Access review, credited objective cover, endpoint review, live catalog checks |
| Ingalls Peak via Ingalls Way and South Ridge | Reject | Mapped approach stops 118.7 m from the summit; no source connector or approved terrain review |
| Colchuck Lake Trail | Graph passes; stats reject | Official gain basis unstated; selected first-shore path is 19.35% shorter than the official 9-mile round trip; cover and access review missing |
| Lake Stuart Trail | Graph passes; stats reject | Official gain basis unstated; cover and access review missing |
| Enchantment Traverse | Reject | Source tags require terrain review; no reviewed Aasgard exposure assessment |
| Esmeralda Basin Trail | Reject | No verified catalog objective or common turnaround; the source continues toward Lake Ann |
| Mount Si Trail | Reject | Haystack source tags require terrain review; catalog summit is 9.7 m from its OSM node |
| Little Si | Reject | Catalog summit is 17.0 m from its OSM node |
| Rattlesnake Ledge | Reject | Source includes mapped steps excluded by the current graph classes |
| Skyline Loop (Paradise) | Reject | New source-bound Skyline trailhead resolves the start identity; mapped steps remain blocked |
| Naches Peak Loop | Graph passes; stats reject | New northern Tipsoo binding resolves start identity; DEM gain 262.83 m exceeds NPS 152.4 m by 72.46%; cover and access review missing |
| Mailbox Peak (new trail) | Reject | Catalog summit is 12.3 m from its OSM node |
| Mailbox Peak (old trail) | Reject | Terrain review missing; catalog summit is 12.3 m from its OSM node |
| Heather–Maple Pass Loop | Reject | Rainy Pass catalog trailhead is about 175 m from the start; selected source is an open chain with a 9.4 m gap |
| Blanca Lake | Reject | Reported road closure blocks this trailhead approach pending reopening evidence |
| Lake 22 | Graph and elevation pass | Access review, credited objective cover, endpoint review, live catalog checks |
| Poo Poo Point (Chirico Trail candidate) | Reject | Source reaches a viewpoint/launch, while the catalog objective identifies the separate summit |
| Tolmie Peak | Reject | NPS reports usual road access closed; catalog summit also differs from its OSM node |
| Mount Pilchuck | Reject | Source lookout endpoint is 14.5 m from the catalog summit; the same-identity OSM summit needs review |

The first reported rejection does not erase other problems. [Endpoint review](endpoint-review.json), both source inventories, and [graph-dry-run.jsonl](graph-dry-run.jsonl) retain the details. The current filter permits `path`, `footway`, and `track`; it does not silently replace missing or excluded edges. The Ingalls Peak gap, open Maple Pass chain, and all summit gaps remain unfilled.

The seven admitted paths use unchanged OSM vertices. Naches uses the complete source loop from the new northern Tipsoo trailhead, with zero start-coordinate gap; its 5,633.955 m length differs from NPS’s 5,632.704 m by 0.0222%. Lake endpoints use the saved lake boundaries rather than the lake-center points. Serene stops at the named Lunch Rock; Snow Lake stops at the northern source junction beyond the outlet; Ingalls stops at a southern-shore source seam; Lake 22 stops at the mapped outlet bridge. Colchuck and Stuart use reviewed candidate shore-arrival vertices whose exact stopping places still need approval. No point moved to fit a distance or gain figure. See [identity-evidence.json](identity-evidence.json) for the supporting research and its limits.

| Candidate | Stored path, km | DEM gain, m | DEM loss, m |
| --- | ---: | ---: | ---: |
| Lake Serene | 5.523 | 826.85 | 217.75 |
| Snow Lake | 5.387 | 554.35 | 229.99 |
| Ingalls Lake | 7.107 | 907.22 | 226.64 |
| Colchuck Lake | 5.841 | 740.66 | 39.97 |
| Lake Stuart | 6.658 | 571.60 | 55.15 |
| Lake 22 | 3.949 | 503.71 | 94.48 |
| Naches Peak Loop | 5.634 | 262.83 | 293.59 |

These values use the existing route elevation-stat calculation. The first six paths are outward legs; Naches is a complete loop. They do not establish approval of the full named hike. A return journey doubles the outward distance and accumulates outward gain plus loss. A source that says “round trip” for distance does not establish its elevation-gain basis. The [USFS-hosted 2025 report, page 3](https://research.fs.usda.gov/download/treesearch/80472.pdf) reports Colchuck at 9 miles and 2,342 feet, Stuart at 9 miles and 1,840 feet, and the traverse at 18.5 miles and 4,845 feet. All remain in the manifest. The first two gain bases stay unspecified. The 15% tolerance is unchanged.

The DEM files sample each exact source vertex through the existing `sampleTerrariumProfile` helper at zoom 14. A second fetch reproduced every sample in the initial six profiles exactly. Naches adds 481 exact source-point samples and two fetched tiles. The files include full provider credit; [current tile receipts](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/terrain-tile-receipts-09f5fbb31581.json) preserve request URLs and PNG hashes. The initial receipt file remains unchanged. DEM completion alone does not establish route safety, endpoint identity, or agreement with published statistics.

Route IDs, shared database segment IDs, difficulty, and search ranks remain `null` in the offline report because those operations have not run. Shared OSM way IDs are source evidence, not database segment IDs. Every admitted objective lacks a credited cover in the saved catalog snapshot. Current access, duplicate identity, exact shared-segment reuse, source-span proof, and final SQL publication checks still require a live reviewed run.

[proposed-trailheads.json](proposed-trailheads.json) contains complete review-only records for the named Skyline and Tipsoo Lake OSM trailheads, following `20260730_standard_route_trailheads.sql`. Each carries a source snapshot hash, exact source coordinates, a credited DEM elevation, and region evidence. [trailhead-identity-preflight.sql](trailhead-identity-preflight.sql) must be reviewed and run before any insert to check source IDs, names, proposed IDs, and nearby catalog rows. Rainy Pass already has the same identity and needs a reviewed repair, not a duplicate. The current manifest binds the two inserted source-bound rows. It leaves the Skyline steps block and Naches gain mismatch in place. Rainy Pass and all other unresolved route gates remain unchanged.

To reproduce the local report from saved files, run from `cloud-sql/migrate`:

```sh
node --import tsx data/trail-catalog/wa-cascades-20261013/replay.ts
```

This uses the production graph builder and elevation checks with saved source/catalog data. It writes a JSONL report and GeoJSON whose names include the manifest hash. An existing file must match exactly; otherwise the script stops. An optional final argument chooses a new report basename. The initial [graph-dry-run.jsonl](graph-dry-run.jsonl) and [graph-candidates.geojson](graph-candidates.geojson) remain tied to the exact [initial manifest](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest-initial.json). The [Ingalls evidence replay](graph-dry-run-213a4aec8e0d.jsonl) is tied to [manifest 213a4aec8e0d](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest-213a4aec8e0d.json). The [trailhead-binding replay](graph-dry-run-f5d01dacc488.jsonl) is tied to [manifest f5d01dacc488](../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest-f5d01dacc488.json) and first admits Naches without elevation. The [latest replay](graph-dry-run-a36b10ca21b2.jsonl) uses current manifest SHA-256 `a36b10ca21b2fe8a01f0a7365ef88733b5eca9877c786e376277fc7e2a9a5873`, snapshot SHA-256 `6bb7916bb071a10305e3b8a0a44f791f0c3cf0c7f343388184213df2a360f626`, and the new Naches DEM. It preserves the gain rejection. To re-fetch the exact public terrain samples for comparison, run:

```sh
node --import tsx data/trail-catalog/wa-cascades-20261013/fetch-dem.ts --verify-existing
```

The re-fetch stops if any saved sample changes. `prepare-trailheads.ts` regenerates the review-only trailhead fixture from the fixed source nodes and public DEM tiles. Neither script opens a database. The general `routes:pilot` CLI has its own audit-write behavior; it was not used for this offline report.

[Access review](access-review.json) records current USFS trailhead status, the ended Snow Lake maintenance interval, an unresolved earlier Ingalls fire closure, and unavailable source pages. Open trailhead status alone does not complete route review. No new route has been activated.

For the next operator-run production dry run, use the current manifest at
`cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest.json` with
SHA-256 `a36b10ca21b2fe8a01f0a7365ef88733b5eca9877c786e376277fc7e2a9a5873`.
From `cloud-sql/migrate`, choose a new report path:

```sh
npm run routes:pilot -- \
  --manifest data/trail-catalog/wa-cascades-20261013/manifest.json \
  --report /private/tmp/peaks-trail-catalog-pilot-a36b10ca21b2-dry.jsonl
```

This invokes the normal dry mode, which may write a `data_source_runs` receipt
but does not insert routes. It still requires live duplicate, metadata, source,
and segment checks. No pending-write or activation flag is included.
