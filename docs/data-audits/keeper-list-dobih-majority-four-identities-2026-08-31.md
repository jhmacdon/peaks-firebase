# DoBIH Majority-Four Identity Analysis — 2026-08-31

## Status

This change checks identities only. It does not add an importer, write production
data, create routes, or queue cover photos. The checked report is incomplete and
the builder refuses to write it unless the operator passes `--allow-incomplete`.
That flag writes an audit report; it cannot publish a list or destination.

The four lists remain unpublished. Identity review still has 530 open rows. A
later change must resolve them, then pass the route, destination-cover, and
route-cover gates.

This change adds no service, timer, or other running resource. Run-rate change:
**$0/month**.

## Pinned inputs

| Input | SHA-256 |
| --- | --- |
| Majority-four source fixture | `de3b4025b66e5f7dde1decb2e7a48784044054e0280de46df2d81cc8c8de0eec` |
| Base-three source fixture | `d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d` |
| Base-three resolution fixture | `326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77` |
| Open-eight source fixture | `3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae` |
| Open-eight resolution fixture | `bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Fresh production catalog snapshot | `897feb3c3d0bf132694cfcb7455bb43a6b7ad7049f3fbd486bfd16244bfbe8aa` |
| Checked identity report | `89fda806ed30ceaea4eaa3176ed0d2ccc913ef5ae5b78f0552118e6df3cdcdcf` |

The DoBIH archive hash remains
`0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021`.
DoBIH v18.5 is licensed CC BY 4.0.

The catalog query ran in a `REPEATABLE READ READ ONLY` transaction. It saved
2,524 Peaks-owned point summits inside longitude `-11..3` and latitude `49..61`,
ordered by destination ID, to
`/private/tmp/dobih-majority-four-catalog-2026-08-31.csv`. The bounds keep five
rows with no country code, including a row needed to check a prior repair. They
also keep nearby rows with other country codes so a later curated destination
cannot miss a close duplicate.

## Results

The source fixture still has 1,627 memberships and 1,015 unique DoBIH
identities. Every source row matches the pinned DoBIH name, aliases, height,
point, list flags, and country code.

Of the 317 identities seen in the base-three or open-eight rosters:

- 120 reuse exact saved resolution rows;
- 196 still resolve to one catalog destination under the prior automatic rule;
- one stays open because the prior automatic rule would merge two DoBIH tops.

The open prior row is `dobih:2483` Armboth Fell. Its automatic candidate is the
catalog destination already reviewed for `dobih:3761` Armboth Fell (Birkett).
The report keeps the reviewed Birkett decision and refuses the automatic merge.

Of the 698 new identities:

- 169 have one normalized name-or-alias match in Great Britain, no more than
  100 metres of height difference, and no more than 250 metres from the DoBIH
  point;
- 526 have no unique match under that rule;
- three found a name match that belongs to another DoBIH identity, so the
  report rejects those merges too.

The three rejected new matches are:

| New source | Catalog destination already used by |
| --- | --- |
| `dobih:2667` Top o' Selside | `dobih:3863` Top o' Selside (Wainwright summit) |
| `dobih:7833` Gowbarrow Fell | `dobih:2610` Gowbarrow Fell (Wainwright summit) |
| `dobih:19414` Brock Crags | `dobih:2582` Brock Crags |

The report records up to five nearby GB catalog summits for each new identity.
It also records every catalog summit and every other source point within 150
metres. Six source pairs fall inside that guard. A later resolution must reuse
the same summit, repair the same summit, or name every distinct neighbor in its
`distinctFromDestinationIds`. This change creates zero curated destinations.

## Publication blocks

Identity matches do not clear route safety. These rows stay blocked:

- `dobih:2390` Pillar Rock is an exposed rock climb. Do not publish a hiking
  route. The list needs exact optional-member support or a reviewed technical
  climb model first.
- `dobih:2711` Mickle Fell, `dobih:2713` Little Fell, and `dobih:2735` Murton
  Fell need approved Warcop access and the current range warning.
- `dobih:2877` High Willhays needs the current Dartmoor range access check and
  warning.

The report marks these blocks even when a catalog identity matches. It makes no
route claim.

## Rebuild

With the pinned DoBIH CSV and saved catalog snapshot present, run:

```sh
npm run analyze:keeper-list-identities:dobih-majority-four
```

The explicit incomplete flag in that package command lets the tool rewrite the
checked report. Calling the builder without the flag exits with an error while
any identity remains open. The output must keep the checked hash and counts.
