# Smaller DoBIH Majority-Four Identity Analysis — 2026-08-31

## Status

This change checks identities only. It does not add an importer, write production
data, create routes, or queue covers. The checked report is incomplete and the
builder refuses to write it unless the operator passes `--allow-incomplete`.
That flag can only write the audit report.

The four lists remain unpublished. Identity review still has 359 open rows. A
later change must resolve them, then pass the destination-cover, safe-route, and
route-cover gates.

This change adds no service, timer, job, or running resource. Run-rate change:
**$0/month**.

## Pinned inputs

| Input | SHA-256 |
| --- | --- |
| Smaller majority-four source fixture | `4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b` |
| Base-three source fixture | `d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d` |
| Base-three resolution fixture | `326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77` |
| Open-eight source fixture | `3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae` |
| Open-eight resolution fixture | `bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Read-only production catalog snapshot | `b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab` |
| Checked identity report | `4862036f5fe1149c496af9f4c99af0ab213b02fbcf494307794dfe55fef940f3` |

The DoBIH archive hash remains
`0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021`.
DoBIH v18.5 is licensed CC BY 4.0.

The catalog query ran in a `REPEATABLE READ READ ONLY` transaction. It saved
2,524 Peaks-owned point summits inside longitude `-11..3` and latitude
`49..61`, ordered by destination ID, to
`/private/tmp/small-majority-catalog-20260831.csv`. It includes rows with
missing or non-GB country codes for duplicate checks. Its identity columns
match the catalog scope used by the larger analysis.

## Exact scope

The four source rosters contain 678 memberships and 648 unique DoBIH
identities:

| List | Memberships | Prior reviewed identities | New identity memberships |
| --- | ---: | ---: | ---: |
| Welsh 3000s | 15 | 15 | 0 |
| Great Britain Submarilyns | 100 | 9 | 91 |
| Donald Deweys | 247 | 1 | 246 |
| Hewitts of England and Wales | 316 | 116 | 200 |

The row totals overlap across lists, so the distinct split is 121 prior
identities and 527 new identities. The builder checks every source name, alias,
height, point, list selector, and country against the pinned DoBIH CSV.

## Prior decisions

All 121 prior identities still resolve without a conflict:

- 27 reuse exact saved resolution rows;
- 94 still resolve to one catalog destination under the prior automatic rule;
- zero need new review;
- zero share a destination with another source identity.

This includes all 15 Welsh 3000s, which already belong to the reviewed Furths.
No prior auxiliary catalog repair is needed by this smaller set.

## New identity preparation

Of the 527 new identities:

- 168 have one normalized name-or-alias match in Great Britain, no more than
  100 metres of height difference, and no more than 250 metres from the DoBIH
  point;
- 359 have no unique match under that rule and stay open;
- zero automatic matches collide with a prior or new source identity.

The accepted 168 destinations are unique and cross-checked against the shared
`resolveKeeperList` rule. The report records up to five nearby GB catalog
summits for every new identity. It also records each catalog summit and source
identity within 150 metres. This smaller set has no source-source pair inside
that bound. The change creates zero curated destinations.

## Route publication blocks

Identity matches do not clear route safety. The report copies these exact
`routePublicationAllowed: false` blocks from the source bundle:

- `dobih:2711` Mickle Fell;
- `dobih:2713` Little Fell;
- `dobih:2735` Murton Fell;
- `dobih:2877` High Willhays.

The first three need approved Warcop access and a current firing notice. High
Willhays needs the current Dartmoor access and firing notice. This report makes
no route claim and has no route publication path.

## Rebuild

With the pinned DoBIH CSV and catalog snapshot present, run:

```sh
npm run analyze:keeper-list-identities:dobih-smaller-majority-four
```

The package command carries the explicit incomplete-report flag. Calling the
builder without that flag exits with an error and writes no output while any
identity remains open. The output must keep the checked hash and counts.
