# Mount Baker glaciers — review packet, 2026-10-29

First Washington region after Rainier. Offline work only: no production reads
or writes, no OSM edits. Builder: `cloud-sql/migrate/src/import-baker-glaciers.ts`
and `src/glaciers/baker.ts`. Outline decisions:
[Markdown](baker-glacier-outline-decisions-2026-10-29.md),
[JSON](baker-glacier-outline-decisions-2026-10-29.json). Verification SQL:
[baker-glacier-verify-2026-10-29.sql](baker-glacier-verify-2026-10-29.sql).

Reviewed manifest SHA-256:
`3586a87dba5b42f0571af85bcc2cfc194e8381e3125d879590bfa7d8ec9baf78`.

## Sources and licences

| Source | Use | Licence and evidence | Saved file (SHA-256) |
| --- | --- | --- | --- |
| OpenStreetMap `natural=glacier`, Overpass mirror `overpass.private.coffee`, bbox 48.68,-121.98,48.88,-121.65 | Outlines and identities | ODbL-1.0, © OpenStreetMap contributors | `baker-glaciers-overpass.json` (`908c2362…b18f2`) |
| Fountain, Glenn & McNeil (2023) inventory, GLIMS WFS `GLIMS:GLIMS_Glacier_Outlines`, cohort 2015-09-09 / submission 814 / Portland State University | Area facts (2015), outline candidate | CC0-1.0: PDXScholar record "This work is marked with CC0 1.0 Universal" (`licence-evidence/pdxscholar-fountain-glenn-cc0.txt`) | `glims-wfs-baker.json` (`03e51afd…0e43e4d`) |
| Same WFS file, cohorts 1975-09-09 and 1974-09-09 (submission 744) | Historical reference for the age gate only | Not cleared for replacement (same rule as Rainier) | same file |
| RGI 7.0, region 02, served by GLIMS WFS `GLIMS:RGI2000-v7.0-G-02_western_canada_usa_epsg3857` | Head elevation (`zmax_m`); older-extent attributes in provenance | CC BY 4.0: rgidata.org "The RGI may be used freely under the Creative Commons Attribution 4.0 International License" (`licence-evidence/rgi-data-distribution-policy.txt`) | `rgi7-wfs-baker.json` (`d1de1ab2…b2669`) |

No agency outline dataset is used. The PSU download page sits behind a bot
check and was not tried; the plain record page served the rights statement.
All requests sent `User-Agent: PeaksApp-glacier-import/1.0` and nothing else
identifying.

**OSM snapshot age.** `overpass-api.de` reset every connection from the cloud
agent's network. Both reachable mirrors serve an older database:
`timestamp_osm_base` is 2026-06-01T08:52:28Z (`kumi.systems`: 2026-05-31). The
manifest records 2026-06-01 as the snapshot date, not the fetch day. A
privileged session may refetch from `overpass-api.de` and rebuild; that changes
the snapshot hash and every downstream hash.

## Roster

14 named OSM glaciers that flow from Mount Baker. Left out of the snapshot box:

| OSM element | Name | Reason |
| --- | --- | --- |
| way:303268527 | Table Mountain Glacier | Parent Table Mountain, not Baker; 0.033 km² in OSM. North Cascades package. |
| way:427944613 | Sisters Glacier | Parent Twin Sisters Mountain. North Cascades package. |
| 22 ways/relations | unnamed | Named glaciers only. |

Inventory names with no OSM polygon: **Bastile Glacier** (0.024 km² in 2015).
It counts in the inventory total ("of 15") but is not imported. Camp Kiser and
Coleman Pinnacle are inventory snow patches named after Ptarmigan Ridge
landmarks, not glaciers of the volcano. No snowfields: no named snowfield on
Baker is a common climbing crossing in OSM.

## Facts

| Field | Source | Observed |
| --- | --- | --- |
| `area_km2`, `rank_on_mountain`, `observed_year` | PSU 2015 cohort, sum of `db_area` over the name's parts | 2015 (GLIMS nominal date; imagery 2013–20, mostly 2015) |
| `head_elevation_m` | RGI 7.0 `zmax_m` (COPDEM30 over the 1974–75 outline), whole metres | outline 1974/1975 |
| `mountain_context` | 15 named glaciers, 36.837 km², 2015 | 2015 |
| all others | null | — |

Held back, kept in `provenance.rgi_older_extent`: RGI terminus, length, slope
and the 1974–75 area. They describe the old outline. A per-glacier history
was tried and dropped: the two inventories draw different divides (Boulder
would show −46% while Park gained 1.5%). Flow direction is null: RGI
`aspect_deg` is surface aspect, which the contract excludes. No descriptions:
no reusable per-glacier text was found.

The GLIMS/facts ratio is 1.000 by construction, because the facts area comes
from the same 2015 cohort. The decision rule still compares OSM with that area.

## Outline decisions

All 14 places keep OSM. Flagged (2 of 14, 14%):

- **Park Glacier**, OSM/facts 1.506. OSM Park takes ice that the 2015 cohort
  gives to Boulder (OSM Boulder 0.850). Combined Park+Boulder is 7.686 OSM vs
  6.577 GLIMS (1.17). It is a divide difference, not old ice. No age evidence:
  the 1975 reference does not fit OSM better.
- **Talum Glaciers**, OSM/facts 0.623. OSM Squak (1.179) takes ice the cohort
  gives to Talum. Combined Squak+Talum: 3.441 vs 3.808 (0.90).

Also noted:

- 2015 **No Name Glacier** parts are invalid as an inventory system ("Orphan
  outline hole"). OSM is kept and is inside the band (0.726).
- The 1974 reference matches only Easton; 1975 covers the rest.

## Parent mountain

Proposed parent for all 14: **Mount Baker** (`summit`, `volcano`; US-WA;
48.7768, -121.8144; match radius 3000 m). The privileged step resolves the ID.

| Glacier | Nearest ice to summit (m) | Centroid distance (m) | Bearing | Head (RGI zmax, m) | Call |
| --- | ---: | ---: | ---: | ---: | --- |
| Boulder | 69 | 1,672 | 115 | 3,275 | clear |
| Park | 98 | 1,718 | 76 | 3,252 | clear |
| Roosevelt | 137 | 2,027 | 315 | 3,278 | clear |
| Coleman | 489 | 2,575 | 280 | 3,278 | clear |
| Deming | 579 | 2,547 | 241 | 3,274 | clear |
| Mazama | 891 | 2,539 | 23 | 2,870 | clear |
| Talum | 906 | 2,213 | 149 | 3,051 | clear |
| Squak | 1,071 | 2,581 | 181 | 3,015 | clear |
| Easton | 1,103 | 2,876 | 212 | 2,972 | clear |
| Rainbow | 2,217 | 3,465 | 58 | 2,563 | clear (NE flank of the cone) |
| Thunder | 2,697 | 3,473 | 266 | 2,576 | **flag**: heads below Colfax Peak, a Baker subsidiary summit |
| No Name | 3,195 | 3,561 | 345 | 2,368 | **flag**: north flank, below Hadley Peak |
| Sholes | 3,407 | 4,778 | 49 | 2,093 | **flag**: low NE flank, toward Ptarmigan Ridge |
| Hadley | 4,211 | 4,715 | 347 | 2,247 | **flag**: below Hadley Peak |

The four flagged glaciers lie on Mount Baker's edifice, and inventories and
Wikidata describe them as Baker glaciers. Colfax Peak and Hadley Peak are
subsidiary points of the volcano. The proposal keeps Mount Baker as their
parent, but each needs a reviewer's call.

## Containing area

The importer now allows a per-place container. Coverage was checked against
the USFS EDW Mount Baker Wilderness boundary (analysis only, not committed).

- **Mount Baker Wilderness** (`wilderness`): Boulder, Coleman, Hadley, Mazama,
  No Name, Park, Rainbow, Roosevelt, Sholes, Thunder. The smallest margin is
  Boulder, 139 m.
- **No container**:
  - Easton (21% inside) and Squak (21% inside) cross into the Mount Baker
    National Recreation Area.
  - Deming is 99.8% inside.
  - Talum is covered, but only 11 m from the line.

The production apply checks real PAD-US coverage before its first write. A
mismatch stops the import.

## Disposable-DB check

PostgreSQL 15.19 with PostGIS 3.6.4. Fixtures: Mount Baker parent and the real
EDW wilderness polygon as the area.

- Import and replay: replay unchanged.
- A fixture route and session from the south side cross Easton → Squak →
  Boulder in both route and session crossings.
- The backfill drained to `processed=0`.
- All missing-row queries return no rows. Exception: the exact `ST_Equals`
  piece check lists 8 glaciers whose pieces differ by ≤ 1.5 cm Hausdorff
  (≤ 12 m² symmetric difference). That is piece-split roundoff; the runbook
  allows a tolerance for it.
