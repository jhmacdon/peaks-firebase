# Glacier manifest hashes

Since PR "make glacier manifest hashes platform-stable", every computed
outline metric (areas in km², overlap areas and shares, IoU, area ratios) is
rounded to `METRIC_DECIMALS` = 9 decimal places
(`cloud-sql/migrate/src/glaciers/outline-geometry.ts`) before it is compared,
hashed or written. Before that, the projection's libm calls made the last
digits, and so the hash, differ between Linux and macOS: the Baker package
hashed to `3586a87d…` on Linux and `1c0289af…` on macOS with identical
decisions. Source coordinates and source attribute values are not rounded.

The rebuild changed no decision, flag, match, geometry or fact for either
applied mountain; only review numbers beyond the 9th decimal and therefore
the hashes changed.

| Package | Applied with | Platform-stable hash (replay with this) |
| --- | --- | --- |
| Rainier (`import-rainier-glaciers.ts`) | `1561f541bae318aaf313477c12967e8d9eb7919cf13f1200fc094a2c5c708794` on main before this change (the runbook's earlier `1ca5fb08…` predates later builder edits) | `3b7f23b88afd37b1c4d2e67fac6e67bb1591aa28a79b1ed67209637e3606fbcd` |
| Mount Baker (`import-baker-glaciers.ts`) | `3586a87dba5b42f0571af85bcc2cfc194e8381e3125d879590bfa7d8ec9baf78` | `c082ef875e6d6bf8e3173183bf62c3c791a873bb87de0f3771ee596393694c13` |

A replay of an applied mountain passes the new hash to
`--expected-manifest-sha256`. The writer skips unchanged rows, but each row's
stored `provenance.outline.review` numbers move to the rounded values, so a
replay rewrites those facts rows once. Checked on a disposable database
(Baker applied with `3586a87d…`, then replayed with `c082ef87…`): all 14 facts
rows got a new `updated_at`; outline revisions, destination rows, route and
session queues and crossings were unchanged, since the queue triggers compare
the outline bytes. Nothing needs replaying now: the stored rows are correct.

Apply rule: rebuild the manifest on the apply machine and compare its printed
`manifest_sha256` with the PR's before `--apply`.

## Touching holes (2026-10-29, later PR)

OSM and inventory holes may touch their exterior at a shared vertex (valid
OGC geometry; Olympic White Glacier relation 18773387 does). The OSM parser
and outline metrics now test a hole vertex that is not shared with the ring
it is tested against. Baker's 2015 No Name inventory system was rejected as
"Orphan outline hole" and is now a valid candidate; its decision is
unchanged (OSM, ratio 0.726 in band), but the review and hash change:

| Package | Hash after this change |
| --- | --- |
| Rainier | `3b7f23b88afd37b1c4d2e67fac6e67bb1591aa28a79b1ed67209637e3606fbcd` (unchanged) |
| Mount Baker | `ecca694dbab15a7614ad06a83c963e8827a8d65fd9d9eeaba0f3be410c20c833` |
| Glacier Peak | `9e183267f40c53f458a63c3a4be1ddf4dce23c0b1d34a02e639967a6b97ade02` (unchanged) |

A Baker replay after this change uses `ecca694d…`; like the rounding change,
it rewrites only provenance on the facts rows.


## Hole contacts checked in full (2026-10-29, later PR)

The touching-holes change tested one free hole vertex. That accepted a hole
that leaves its exterior between two shared vertices (wrong area: 0.53 km²
for 0.85) and a hole that touches its exterior twice, which cuts the interior
in two. Every free hole vertex must now lie inside the exterior and outside
the other holes, and the rings and their contact points must form no cycle
(at most one shared point per ring pair, and no chain of touching holes from
the exterior back to it). Multipolygon parts test every free vertex too. The
same PR counts each GLIMS analysis once when its WFS rows repeat it, and sums
a name's parts from several GLIMS glaciers only when they lie within 1 km of
each other or the config lists their glac_ids.

No applied package changes:

| Package | Hash after this change |
| --- | --- |
| Rainier | `3b7f23b88afd37b1c4d2e67fac6e67bb1591aa28a79b1ed67209637e3606fbcd` (unchanged) |
| Mount Baker | `ecca694dbab15a7614ad06a83c963e8827a8d65fd9d9eeaba0f3be410c20c833` (unchanged) |
| Glacier Peak | `9e183267f40c53f458a63c3a4be1ddf4dce23c0b1d34a02e639967a6b97ade02` (unchanged) |

## Outline rule 2 and the neighbour check for applied mountains (2026-10-29)

Rule 2 (#290) treats OSM extents as undated: an out-of-band OSM outline
gives way to the newest dated licence-OK inventory outline whose ratio is
closer to 1. The neighbour check then puts any connected group of touching
glaciers whose final outlines overlap (over 1% of the smaller or 0.01 km²)
on one source. Replayed on a disposable database: the main manifest applied,
then the new one, then the new one again (unchanged).

| Package | Applied hash | Hash after this change | Outline changes |
| --- | --- | --- | --- |
| Rainier | `3b7f23b8…` | `a47c05a3e67d8e8c59d15de5b971844a61572864b6406008a73a30ac293eeca7` | Sarvant: OSM 0.227 km² → PSU 2019 0.325 km² (ratio 0.596, rule 2). No overlaps. |
| Mount Baker | `ecca694d…` | `05f2ef2e0fa9ec7a247ef09253a0308bb957abf2556afe870b20b4993be16c7e` | Park (1.506) and Talum (0.623) switch under rule 2; Talum's PSU outline then overlaps Squak's OSM outline by 0.331 km² (17.5% of the smaller), so the one touching group of 12 goes to the PSU 2015 inventory (12 of 12 ratios in band, against 10 on OSM). Hadley and No Name stay OSM. |
| Glacier Peak | `9e183267…` | `34d7b0da90a1a93ec72088a1821f7a4401bf9290a324a33e18ca812610423ce7` | Milk Lake: OSM 0.365 km² → PSU 2015 0.023 km² (ratio 15.8, rule 2). No overlaps. |

Baker outline areas, OSM → PSU 2015 (km²): Boulder 2.874 → 3.381, Coleman
5.732 → 6.056, Deming 3.851 → 4.382, Easton 2.778 → 3.015, Mazama 3.834 →
4.424, Park 4.813 → 3.196, Rainbow 1.676 → 2.004, Roosevelt 3.340 → 3.700,
Sholes 1.108 → 1.015, Squak 2.264 → 1.921, Talum 1.177 → 1.888, Thunder
0.840 → 0.795. Every other row in the three packages changes provenance only
(the review records rule 2). Facts are unchanged.
