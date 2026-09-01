# Keeper list identity audit — 2026-08-30

This import adds three lists from their keepers. The saved roster fixture fixes each source row and its order. The reviewed resolution fixture pins every row that strict matching cannot settle.

| List | Keeper roster | Members | Automatic matches | Reviewed existing or repair | New destinations | Final dry run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Corbetts | DoBIH v18.5, `C=1` | 222 | 199 | 17 | 6 | 222 / 222 |
| Wainwrights | DoBIH v18.5, `W=1` | 214 | 168 | 36 | 10 | 214 / 214 |
| UIAA Pyrenees main 3000ers | UIAA Bulletin 152 main peaks | 129 | 0 | 83 | 46 | 129 / 129 |

The dry run planned 62 new destinations and 13 guarded catalog repairs. Seven auxiliary repairs correct neighboring or reused catalog identities; most target non-list tops. Every list had its exact count, unique destinations, and zero unresolved rows.

## Sources and roster rules

[The Database of British and Irish Hills v18.5](https://www.hill-bagging.co.uk/dobih/downloads/) supplies the Corbett and Wainwright rosters, source IDs, order, heights, and source points. Its data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The list records show that credit and source link to users. The Scottish Mountaineering Club and the Wainwright Society remain the named list keepers.

The [UIAA Pyrenees page](https://www.theuiaa.org/3000-pyrenees/) says the official list has 129 main peaks, but its current table has 130 rows. The saved roster follows the original main-peak list in UIAA Bulletin 152. It excludes the secondary peaks Pico Maubic and Punta Gabarró, restores Tuca de Llardaneta as main 072, and corrects the duplicated printed number so Le Bondidier is 103 and Cordier is 104.

The roster fixture records these source hashes:

- DoBIH archive: `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021`
- DoBIH CSV: `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea`
- current UIAA PDF: `f5e04888dac26133f3f9176a74d10c7213d5c14efdb4a092ad5c4f71b4eb29ed`
- Bulletin 152 scan: `3febd345eef36d8384dd355e5f5a96f1b3b4d417fad9f5da2803c04267e23369`

## Identity review

The Corbett review adds only DoBIH rows 82, 413, 596, 744, 1129, and 1835. Rows 415, 633, 903, and 1692 reuse and repair the intended catalog peaks. The Wainwright review adds ten distinct summits. Grange Fell and Stony Cove Pike reuse reviewed catalog identities. High Street reuses `lacAhOp5f1m1pnY4oFzT` and moves its point from the separate trig pillar to the 828.5 m keeper summit, with OSM node `12558883199` and Wikidata `Q1617866`.

The Pyrenees review reuses 82 catalog rows, adds 46 summits, and repairs Pic Badet. Its close-summit guards keep each reviewed pair distinct, including Pic Simó and Pico Jolis.

All new rows state the source of their point and height. UIAA supplies the Pyrenees roster and identity; OSM, DoBIH, or a named survey supplies each new point. The importer rejects an unreviewed summit within 150 metres and accepts a close pair only when the fixture pins the other destination ID. Before a catalog repair, it checks old names, heights, country and state fields, OSM IDs, and full external-ID sets exactly. It allows old points within 5 metres. A stale row fails rather than applying part of the plan.

Review artifacts:

- UK identity review: `/private/tmp/keeper-uk-identity-review-2026-08-30.json`, SHA-256 `64664c4f398dc84a6c8680fa6e46d9e21436456c379fd58db1fbd629e8c4e674`
- UIAA resolution review: `/private/tmp/keeper-list-resolutions-uiaa-pyrenees-2026-08-30.json`, SHA-256 `034f401453cff61baa5c312189639e4248681f0b83aa267176cdcc395dd8bf26`
- UIAA crosswalk: `/private/tmp/uiaa-pyrenees-reviewed-crosswalk-2026-08-30.json`, SHA-256 `8aa066afb6794422ee907eee6d4aacdf7b6ae312acc8da24b4dcec8a07a85039`
- live collision audit: `/private/tmp/keeper-current-collision-audit-2026-08-30.txt`, SHA-256 `61f2c22bb4d5159d616a46a8ffb35ec873210fd2368d48ed4897ad2f07ccec4a`

The checked-in [roster fixture](./fixtures/keeper-list-candidates-2026-08-30.json) and [resolution fixture](./fixtures/keeper-list-identity-resolutions-2026-08-30.json) hold the reviewed data used by the importer.

## Read-only production check

The final command ran through the existing database wrapper without `--apply`. The importer opened a repeatable-read, read-only transaction and rolled it back. It made no production changes.

Saved report: `/private/tmp/keeper-lists-final-dry-run-2026-08-30.json`, SHA-256 `2d62959d49b8bc2e27767cd7c695918857dcc3b5379df34bd6ef4ba150449695`.

The result was `complete=true`: Corbetts 222/222, Wainwrights 214/214, and UIAA Pyrenees 129/129, with 62 destinations to add, 13 to repair, and zero unresolved rows.

For changed or new destinations, an apply run would rebuild only PostGIS-made area links. It preserves manual area links. The read-only catalog check found no current area links on the reviewed moved rows.

This change adds data and an on-demand importer. It adds no service, timer, scheduled job, or always-on resource. Run-rate change: **$0/month**.
