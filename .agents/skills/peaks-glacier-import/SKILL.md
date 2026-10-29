---
name: peaks-glacier-import
description: Add the glaciers of one more mountain to Peaks, the way Mount Rainier's were added on 2026-10-28. Use when asked to import, add, or prepare glaciers for a mountain; to snapshot OSM natural=glacier outlines; to transcribe glacier facts from a USGS, NPS, GLIMS, RGI, WGMS or Wikidata source into a manifest; or to hand a reviewed glacier manifest to the production apply step. Written so a Claude Code cloud agent (Linux, no gcloud, no production database) can do every step up to the PR.
---

# Peaks Glacier Import

One mountain per run. The output is a PR that adds data and a manifest builder
under `cloud-sql/migrate/` only, plus a hand-off block for the privileged apply.
Read first: [docs/glaciers-api-contract.md](../../../docs/glaciers-api-contract.md)
("Adding another mountain" and "Runbook"), `cloud-sql/migrate/src/glaciers/rainier.ts`,
`cloud-sql/migrate/src/import-rainier-glaciers.ts`,
`cloud-sql/migrate/src/import-glacier-manifest.ts` and
`cloud-sql/migrate/src/__tests__/rainier-glaciers.test.ts`.

## Who runs what

| Phase | Cloud agent | Privileged session or Josiah |
| --- | --- | --- |
| 0 Scope and inputs | yes | answers open questions |
| 1 Sources and licenses | yes | approves any doubtful license |
| 2 Fetch and snapshot | yes, if the environment allows the hosts | supplies files if not |
| 3 Manifest builder | yes | |
| 4 Tests | yes | |
| 5 Disposable-DB check | yes | |
| 6 PR | yes (opens it) | reviews, merges |
| 7 Production apply | **no** | yes, with data-write authorization |
| 8 Post-apply checks | API checks only | SQL checks |

A cloud agent has no gcloud, no Secret Manager and no production database. It
must never guess the parent mountain ID or the park/area ID; those come from
read-only production queries in phase 7. The only exception: the environment
holds explicit production secrets **and** Josiah authorized production writes
for this mountain in this task. Without both, stop at phase 6.

## Stop and ask

Stop, report what you found, and ask before going on when:

- Any change seems needed outside `cloud-sql/migrate/` (API, app, web,
  `cloud-sql/migrations/`, schema). No runtime code may name a glacier or a
  mountain. A new mountain is data plus a builder.
- A source's terms forbid reuse or sharing, or say nothing clear. Example: the
  NPS 2021 Rainier shapefile says it "cannot be shared or used by other entities
  without NPS permission". It is not an input.
- An OSM outline's area is outside 0.67–1.5× the facts source's area and phase 9
  finds no closer cleared outline. Old OSM tracing is common: Van Trump and
  Pyramid on Rainier were about 6× their current area. Do not drop, redraw or
  import it silently.
- The OSM roster and the facts inventory disagree on a name, a split, or a
  merged system, and no source settles the crosswalk.
- No `areas` row can plausibly contain every outline (for example the mountain
  spans a park and a wilderness), or the parent mountain may not exist in Peaks.
- The network policy blocks Overpass or a facts host. Ask for the files or a
  wider policy; do not substitute another source.
- Any production step: a statement timeout (SQLSTATE `57014`), a failed
  preflight, an identity collision, or a backup that is not `SUCCESSFUL`.
  Do not raise timeouts or retry in a loop.

## 0. Scope and inputs

Write down, in the PR body draft:

- Mountain name as stored in Peaks, country/state codes, summit lat/lng, and a
  parent match radius (Rainier: 3000 m). The apply step refuses a parent ID
  that fails any of these, so copy the exact Peaks name and features.
- The container area: `areas.kind` and exact name (Rainier:
  `national_park`, `Mount Rainier National Park`). Every outline must lie inside it.
- A bounding box (S,W,N,E) that holds every glacier on the mountain and as
  little else as you can. Neighbors inside the box are filtered out in phase 3.
- `activities` for the rows (Rainier: `outdoor-trek`, `ski`).
- Date slug `<mountain>-<YYYY-MM-DD>` (today) for the data directory.
- Open inputs for phase 7: `<parent-mountain-id>` and `<park-area-id>`.

## 1. Source discovery and license check

Outlines: **OSM `natural=glacier` via Overpass only.** License ODbL-1.0,
credit `© OpenStreetMap contributors`.

Facts: one citable source per glacier, best first:

| Source | License / use | Notes |
| --- | --- | --- |
| USGS or NPS reports and NPS place pages | U.S. Government work | Check figures and photos for third-party rights. Rainier used Beason et al. (2023), DOI 10.36967/2299328. |
| GLIMS | free with citation; read the current NSIDC terms | Outline dates vary; check the analysis date per row. |
| RGI 7.0 | CC BY 4.0 | Many US outlines date from the 1940s–80s. Record that year as `observed_year`. |
| WGMS (Fluctuations of Glaciers) | free with citation; read the terms | Good for length and mass-balance series. |
| Wikidata | CC0 | Often lacks area or elevation. Never treat a summit or point elevation as a glacier head. |

Do not use Wikipedia text for descriptions (CC BY-SA). Do not use any agency
outline dataset in place of OSM. For each source, save the terms text or URL
and the license string you will put in the manifest. If two sources cover
different fields, record per-field provenance (phase 3).

## 2. Fetch and snapshot

Data directory: `cloud-sql/migrate/data/glaciers-<mountain>-<YYYY-MM-DD>/`.

Overpass needs a descriptive User-Agent; it returns 406 without one. Never put
a personal email, name or other identifying detail in it.

```bash
DIR=cloud-sql/migrate/data/glaciers-<mountain>-<YYYY-MM-DD>
mkdir -p "$DIR"
cat > "$DIR/overpass-query.txt" <<'Q'
[out:json][timeout:120];
(
  way["natural"="glacier"](<S>,<W>,<N>,<E>);
  relation["natural"="glacier"](<S>,<W>,<N>,<E>);
);
out meta geom;
Q
curl -sS --fail -X POST https://overpass-api.de/api/interpreter \
  -H 'User-Agent: PeaksApp-glacier-import/1.0 (https://github.com/jhmacdon/peaks-firebase)' \
  --data-urlencode "data@$DIR/overpass-query.txt" \
  -o "$DIR/<mountain>-glaciers-overpass.json"
sha256sum "$DIR/<mountain>-glaciers-overpass.json"   # macOS: shasum -a 256
```

Check the response before going on: it must be JSON, have an `elements` array,
carry `osm3s.timestamp_osm_base`, and have no `remark` (a remark means a timeout
or error). If the main host fails, the same query works on the mirrors listed
in `cloud-sql/migrate/src/expand-lake-coverage.ts` (`OVERPASS_ENDPOINTS`).
Never edit the saved bytes; refetch instead and use the new hash.

Facts: save each source as text in the same directory. Rainier's layout:
`nps-beason-2023-report.txt` (the report's text, page breaks kept as form
feeds so the parser can find tables) and `nps-place-pages/<name>.txt`. For a
PDF, `pdftotext -layout file.pdf out.txt` keeps table columns. For CSV/JSON
exports (RGI, GLIMS, WGMS), save the raw file plus its query or download URL.
Record each file's SHA-256 in the PR body.

## 3. Manifest builder

Add two files and one npm script. Do not edit `import-glacier-manifest.ts`.

1. `cloud-sql/migrate/src/glaciers/<mountain>.ts`: constants and the facts
   parser. Copy from `rainier.ts`:
   - `SNAPSHOT_SHA256`, `SNAPSHOT_DATE`, `GEOMETRY_CREDIT`, `FACTS_CREDIT`,
     the facts source URL.
   - A parser that reads the **saved** source text and returns
     `GlacierManifestFacts` per place, failing closed when a table or row count
     is off (Rainier throws on `Incomplete report`).
   - A name crosswalk (OSM name → source name), like Rainier's `reportNames`,
     and grouped history scopes, like `historyNames`.
   - Short descriptions only from a saved page about that glacier (not a
     visitor area of the same name), two plain sentences in your own words.
     The manifest has one `description_source_name`/`_license` for all copy.
2. `cloud-sql/migrate/src/import-<mountain>-glaciers.ts`: copy
   `import-rainier-glaciers.ts`. Keep the hash check, `--data-dir`,
   `--write-manifest`, and the call to `applyGlacierManifest`. Change:
   - `DATA_DIR`, file names, `ALIASES`.
   - Outline parsing: `parseOsmGlaciers(snapshot, { roster, snowfields })`
     from `./glaciers/osm`. The roster is the explicit list of `osm_key`s for
     this mountain (missing keys fail); `snowfields` lists OSM names to mark
     kind=snowfield. `import-baker-glaciers.ts` is the second worked example.
   - When one area cannot contain every outline, use `container_areas` and a
     per-place `container_area_key` (null allowed); for glaciers of another
     summit, `parents` and `parent_key`. See "Adding another mountain" in the
     API contract.
   - The roster count check (Rainier: exactly 29).
   - `parent`, `container_area`, `country_code`, `state_code`, `activities`,
     credits, licenses, `mountain_context`.
3. `package.json`: `"import:<mountain>-glaciers": "tsx src/import-<mountain>-glaciers.ts"`.

Facts rules:

- Missing means `null`, never `0` or `""`. Same for whole rows: a glacier with
  no source row keeps every fact null (Rainier's Pinnacle).
- SI units. Convert m² → km² and m³ → km³ in code from the published figure; say
  so in provenance (Rainier: `"4, p.17 (m² converted to km²)"`).
- `observed_year` is the year the facts describe, not the fetch date.
- `provenance` names the source, table/page, license and year for each field
  group. When fields come from different sources, give each its own entry.
- `mountain_context.named_glacier_count` is the facts source's inventory count,
  not the OSM roster count. It drives the "of N" rank.
- `type_code`/`type_label` only where a source states them.
- Flow direction is where ice flows towards, clockwise from north.

Preview without a database:

```bash
cd cloud-sql/migrate && npm ci && mkdir -p .cache
node --import tsx src/import-<mountain>-glaciers.ts > .cache/<mountain>-preview.json
node --import tsx src/import-<mountain>-glaciers.ts --write-manifest=.cache/<mountain>-manifest.json > /dev/null
```

Keep the printed `manifest_sha256`.

## 4. Tests

Add `cloud-sql/migrate/src/__tests__/<mountain>-glaciers.test.ts`, modeled on
`rainier-glaciers.test.ts`:

- Snapshot hash equals `SNAPSHOT_SHA256`; roster count, unique IDs, kinds,
  which places have several polygons; one known Wikidata ID.
- Same manifest hash on a second load.
- Facts cross-check: for two or more glaciers, `assert.match` the raw line in
  the saved source text, then assert the parsed numbers and unit conversions.
- Crosswalk cases: renamed places, grouped histories, null rows and null fields.
- Apply without the right `--expected-manifest-sha256` rejects before any
  connection.

The shared parser's edge cases (holes, stitched ways, fail-closed inputs)
already live in the Rainier test; add parser cases only if you add a parser.

```bash
cd cloud-sql/migrate
./node_modules/.bin/tsc --noEmit -p .
NODE_ENV=test node --test --import tsx \
  src/__tests__/rainier-glaciers.test.ts src/__tests__/<mountain>-glaciers.test.ts
```

## 5. Disposable-DB check

Use PostgreSQL 15 with PostGIS 3.6 to match production. On PostgreSQL 17+ an
old migration fails its index builds because of the maintenance `search_path`,
so do not use a newer server.

Linux container (prefix `sudo` if not root):

```bash
apt-get update && apt-get install -y curl ca-certificates gnupg lsb-release
install -d /usr/share/postgresql-common/pgdg
curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update && apt-get install -y postgresql-15 postgresql-15-postgis-3 postgresql-client-15
pg_ctlcluster 15 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres'\" -c 'CREATE DATABASE peaks_glacier_test'"
```

With Docker instead: `docker run -d --name peaks-pg -e POSTGRES_PASSWORD=postgres
-p 5432:5432 postgis/postgis:15-3.6`, then create `peaks_glacier_test`. Never
use PostGIS 3.5: it returns no span for a path fully inside a glacier.

Provision, then add fixture parent and park rows:

```bash
export ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/peaks_glacier_test
TEST_DB_ROLE_PASSWORD=peaks_test ./cloud-sql/test-db/provision.sh
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT postgis_lib_version(), current_setting('server_version');
INSERT INTO destinations(id,name,search_name,owner,features,country_code,state_code,location)
VALUES('FIXTUREPARENT','<parent.name>',peaks_search_name('<parent.name>'),'peaks',
  '{<parent.features>}','<CC>','<ST>',ST_SetSRID(ST_MakePoint(<lng>,<lat>,0),4326)::geography);
INSERT INTO areas(id,name,search_name,kind,source,source_id,source_version,
  boundary,centroid,bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng)
SELECT 'FIXTUREPARK','<container.name>',lower('<container.name>'),'<container.kind>',
  'fixture','fixture','1',ST_Multi(e),ST_Centroid(e),ST_YMin(e),ST_YMax(e),ST_XMin(e),ST_XMax(e)
FROM (SELECT ST_Expand(ST_MakeEnvelope(<W>,<S>,<E>,<N>,4326),0.2) AS e) s;
SQL
```

The fixture park is a box, so it cannot test real park coverage. The
production apply checks that before its first write.

Import, replay, and backfill:

```bash
cd cloud-sql/api && npm ci && npm run build && cd ../migrate
export GLACIER_DATABASE_URL="$ADMIN_DATABASE_URL"
H=<manifest_sha256 from phase 3>
node --import tsx src/import-<mountain>-glaciers.ts --apply \
  --expected-manifest-sha256=$H --parent-mountain-id=FIXTUREPARENT --park-area-id=FIXTUREPARK
# A second run must succeed and change nothing.
node --import tsx src/import-<mountain>-glaciers.ts --apply \
  --expected-manifest-sha256=$H --parent-mountain-id=FIXTUREPARENT --park-area-id=FIXTUREPARK
node --import tsx src/backfill-glacier-crossings.ts --apply --seed --limit=5
node --import tsx src/backfill-glacier-crossings.ts --apply --limit=5   # until processed=0
```

Then run the runbook step 7 queries from
[docs/glaciers-api-contract.md](../../../docs/glaciers-api-contract.md#runbook-for-the-main-session),
with `'Mount Rainier National Park'` replaced by the container name and the
expected kind counts replaced by yours. Every missing-row query must return no
rows. Then build the area ratio table for the PR:

```sql
SELECT d.name, gf.kind, gf.observed_year,
       round(gf.area_km2::numeric,3) AS facts_km2,
       round((ST_Area(gf.outline)/1e6)::numeric,3) AS osm_km2,
       round((ST_Area(gf.outline)/1e6/NULLIF(gf.area_km2,0))::numeric,2) AS ratio,
       CASE WHEN gf.area_km2 IS NULL THEN 'no facts'
            WHEN ST_Area(gf.outline)/1e6/gf.area_km2 NOT BETWEEN 0.5 AND 2 THEN 'REVIEW'
            ELSE 'ok' END AS flag
FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
ORDER BY flag DESC, d.name;
```

Any `REVIEW` row goes to "Stop and ask". Drop the database when done.

## 6. PR

Branch from current `origin/main`. Commit the data directory, the two new
source files, the test and the npm script. Do not commit `.cache/`. The PR body
carries this checklist, filled in:

- [ ] Sources: each with URL, license string, terms checked, SHA-256 of the
      saved file. No source forbids reuse. No agency outline used.
- [ ] Overpass query, `timestamp_osm_base`, snapshot SHA-256, roster count, and
      each OSM element left out by the roster filter with the reason.
- [ ] Crosswalk table (OSM name → source name, grouped histories, null rows).
- [ ] Area ratio table from phase 5, with every `REVIEW` row explained or
      held for a decision.
- [ ] Null facts listed; no `0` stands in for unknown.
- [ ] Credits: `© OpenStreetMap contributors` (ODbL-1.0) and the facts credit
      and URL; description source and license if any copy is set.
- [ ] `git diff --stat origin/main` touches only `cloud-sql/migrate/`. No
      glacier or mountain name in API, app, web or migration code.
- [ ] Tests and the disposable-DB run passed; paste the commands and results.
- [ ] `manifest_sha256`, and the phase 7 block below with placeholders.

Merging to `main` runs the GitHub Actions deploy. Check the run for the merge
commit; if Actions cannot run (billing or outage), say so and rely on the local
checks. The iOS app needs no change: the API already gates glaciers behind
`X-Peaks-Capabilities: glaciers-v1`. Peaks iOS ships only when Josiah says "ship".

## 7. Production apply (privileged only)

Run from a clean checkout at the merged commit on `origin/main`, on the main
session's Mac, with written authorization for this data write.

```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
cd /path/to/clean/firebase    # at origin/main, merged commit
# Read-only: migrations present, parent and park IDs, no existing rows.
cloud-sql/scripts/peaks-psql -c "SELECT to_regclass('destination_glacier_facts'), to_regclass('glacier_outline_parts')"
cloud-sql/scripts/peaks-psql -c "SELECT id,name,features,country_code,state_code,
  ST_Y(location::geometry) lat, ST_X(location::geometry) lng
  FROM destinations WHERE name='<parent.name>' AND owner='peaks'"
cloud-sql/scripts/peaks-psql -c "SELECT id,name,kind,source,parent_area_id
  FROM areas WHERE name='<container.name>' AND kind='<container.kind>'"
cloud-sql/scripts/peaks-psql -c "SELECT id,name FROM destinations
  WHERE 'glacier'=ANY(features) AND ST_DWithin(location, ST_MakePoint(<lng>,<lat>)::geography, 30000)"
# CPU check on db-f1-micro; note the time and repeat before each batch.
cloud-sql/scripts/peaks-psql -c '\timing on' -c 'SELECT count(*) FROM generate_series(1,2000000)'
```

Pick the one parent and park row that match by name, features, location and
footprint. Never pick an arbitrary same-name row. Then:

```bash
gcloud sql backups create --instance=peaks-db --project donner-a8608 \
  --description="before <mountain> glaciers"
gcloud sql backups list --instance=peaks-db --project donner-a8608 --limit=1   # must be SUCCESSFUL

PW="$(gcloud secrets versions access latest --secret=peaks-db-password --project donner-a8608)"
export GLACIER_DATABASE_URL="postgres://peaks-api:$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PW")@127.0.0.1:5432/peaks"
unset PW
cd cloud-sql/migrate && npm ci
node --import tsx src/import-<mountain>-glaciers.ts | grep manifest_sha256   # must equal the PR's hash
node --import tsx src/import-<mountain>-glaciers.ts --apply \
  --expected-manifest-sha256='<hash>' \
  --parent-mountain-id='<checked-parent-id>' --park-area-id='<checked-park-id>'

(cd ../api && npm ci && npm run build)
node --import tsx src/backfill-glacier-crossings.ts                       # queue counts only
node --import tsx src/backfill-glacier-crossings.ts --apply --seed --limit=5
node --import tsx src/backfill-glacier-crossings.ts --apply --limit=5     # repeat until processed=0
```

The import runs one place per transaction; a failed place rolls back, and a
rerun with the same hash resumes. Space out backfill batches. On SQLSTATE
`57014` (statement timeout) stop: do not raise the timeout. On 2026-10-28
timeouts came from exact geography distance tests against long route paths
and an insert trigger that matched every session; migrations 05–07 fixed
those, but a new one of that kind needs a code fix and review, not a retry.

Then run the runbook step 7 queries through `cloud-sql/scripts/peaks-psql -f`,
with the container name and expected counts for this mountain, and the area
ratio query from phase 5.

## 8. Post-apply checks

```bash
API=https://peaks-api-726404093396.us-central1.run.app
CAP='X-Peaks-Capabilities: glaciers-v1'
# Search finds it, with parent mountain; without the header it must not.
curl -s -H "$CAP" "$API/api/search?q=<name>%20glacier&lat=<lat>&lng=<lng>&limit=5" \
  | jq '[.[] | {id,name,features,glacier}]'
curl -s "$API/api/search?q=<name>%20glacier&lat=<lat>&lng=<lng>&limit=5" \
  | jq '[.[] | select(.features | index("glacier"))] | length'   # must be 0
# Detail JSON: MultiPolygon boundary, credits, nulls not zeros.
curl -s -H "$CAP" "$API/api/destinations/<glacier-id>/glacier" \
  | jq '{name,kind,boundary:.boundary.type,geometry_credit,parent_mountain,
         facts:.glacier|{observed_year,area_km2,head_elevation_m,rank_on_mountain,facts_credit,facts_source_url}}'
# A known route over the ice lists its crossings.
curl -s -H "$CAP" "$API/api/routes/<route-id>" \
  | jq '{glacier_crossings_status,c:[.glacier_crossings[]|{name,pass_index,entered_distance_m,crossed_distance_m}]}'
```

Privileged SQL for the same route:

```sql
SELECT r.name AS route, d.name AS glacier, c.pass_index,
       round(c.entered_distance_m) AS entered_m, round(c.crossed_distance_m) AS crossed_m
FROM route_glacier_crossings c JOIN routes r ON r.id=c.route_id
JOIN destinations d ON d.id=c.destination_id
WHERE c.route_id='<route-id>' ORDER BY c.entered_distance_m;
```

`complete` with `[]` on a route that plainly crosses the ice, or `pending`
after the backfill reached `processed=0`, is a failure: report it.

## 9. Outline freshness refresh

Run after source discovery and before building an apply-ready manifest, and
once a year after the mountain's local melt season. Rainier uses an October
review after August–September melt. Read
[the source research and implemented refresh](../../../docs/glacier-outline-refresh.md)
and [the API contract/runbook](../../../docs/glaciers-api-contract.md).
This is offline catalog work, with no service, timer or recurring fixed cost.
It does not authorize production writes, deployments or edits to OSM.

1. Re-snapshot OSM `natural=glacier`, keeping source bytes, query, snapshot
   time, object identities, parts, holes and SHA-256. Never put a personal
   name, email or other personal information in User-Agents or requests.
   Use a project-only User-Agent such as `PeaksApp-glacier-import/1.0`.
   Fetching or editing a polygon does not establish its imagery date.
2. Check GLIMS for new analyses and other clearly licensed inventories.
   Save exact query, provider, citation, licence evidence, source dates,
   submission/analysis/glacier IDs and hashes. The CC0 Fountain/Glenn/McNeil
   inventory is one cleared input; do not label all GLIMS data CC0. Restricted
   NPS Rainier outlines remain excluded. Prefer the newest complete cleared
   analysis cohort consistently, recording the date/submission in the source
   config. Never mix cohorts to fill gaps. Rainier's first refresh uses
   2019-09-09, submission 814, Portland State University; 2019-08-26 stays out.
3. Build the OSM manifest, then run the generic `refresh-glacier-outlines.ts`
   helper on saved source files. Keep OSM identities even when geometry
   changes. Match normalized names or explicit aliases AND spatial overlap
   (IoU ≥0.1 or candidate overlap share ≥0.5), never names alone. Assemble
   named inventory parts, dissolve shared/overlapping seams, retain holes,
   validate each input and output, and report unmatched or ambiguous records.
   A distant name match cannot supply geometry. Do not clip an independent
   inventory to OSM while calling its output unmodified CC0 inventory data.
4. Keep OSM when outline/facts area is in the inclusive [0.67, 1.5] band.
   Outside it, choose the newest licence-OK candidate whose area ratio is
   strictly closer to 1 and whose observation is newer than the evident OSM
   extent; otherwise retain OSM and flag it. Keep flags when a better choice
   still lies outside the band. Missing individual facts area means retain
   and flag. Never rescale a polygon to match a reported area.
5. Use a verified OSM imagery date when available. Otherwise the implemented
   historical-fit gate requires IoU ≥0.3, historical overlap share ≥0.5, and
   IoU at least 0.1 above the newer candidate's. Record this as inferred older
   extent, never as a verified OSM observation date. If evidence is absent,
   retain OSM and flag it. A recent edit or download cannot clear this gate.
   Check individual facts scope, splits, missing parts and debris separately;
   mountain totals or combined glacier histories cannot clear an individual
   area mismatch. Review observations older than three years or unknown.
6. Produce the JSON and Markdown decision report for every place: OSM,
   candidate and individual facts areas, ratios, overlaps, IDs, source choice,
   flags, date evidence and reason. Review all unmatched/ambiguous features.
   The manifest's `outline_refresh.review_sha256` binds the full report,
   including unmatched records; hash it with `output_manifest_sha256` empty
   to avoid a cycle. Keep the printed final manifest hash for apply.
7. Each place's `geometry` holds its own source URL/hash, actual observation
   or null, snapshot date, licence/link, credit, method and geometry hash.
   The writer stores this under `facts.provenance.outline`, preserves facts
   citations, and fills row geometry columns and catalog metadata from it.
   OSM credit is `© OpenStreetMap contributors`, ODbL-1.0; the selected PSU
   inventory credit is `Fountain, Glenn & McNeil (2023), via GLIMS`, CC0-1.0.
   `outline_observed_at` stays the compatible mapped-date field: actual
   observation when known, otherwise snapshot. It is not a survey date for
   undated OSM. Keep facts' `observed_year` separate. Detail, summaries and
   crossings serve the stored place's own credit/date; no app source list.
8. Run typecheck, relevant lint, focused matching/selection/provenance/report
   tests and the full package suites. The privileged session runs the
   disposable `_test` importer replay/parts/old-and-new crossing-queue test.
   Apply migration 09 once for old row provenance; do not edit migrations
   01–08. Follow phase 7 for checked parent/park IDs, backup and separately
   authorized hash-gated production apply. Replay the same manifest and
   verify no timestamp/revision/queue churn. Drain existing route/session
   queues in small serial batches; use `--seed` only to repair missing queues.
9. If inventories do not meet the freshness need, prepare the later
   Sentinel-2 L2A derivation described in the research doc. Select clear
   late-melt-season scenes, save STAC/scene IDs and terms, check alignment,
   snow/cloud/shadow and debris, protect uncertain and debris-covered ice,
   retain shared divides, and require positive ground evidence and review
   before removing ice. Store actual dates/ranges and retained older margins.
   Preserve ODbL duties for OSM-derived geometry and the Copernicus notice.
   No imagery derivation or debris-mask helper is implemented by the current
   inventory refresh. Missing evidence means retain extent, record the hold
   and next review season; do not invent a current date.

Use `--osm-only` to keep the original Rainier baseline or build another
mountain's OSM manifest. The generic refresh accepts that original manifest,
a saved source config, `--report-prefix` and `--write-manifest`; it has no
network or DB mode. The Rainier builder composes the same generic step by
default. Another mountain needs data, aliases and source config, not API/app
or schema branches. Preserve prior packages for rollback. Agents prepare
OSM contribution evidence only; they do not upload or contact other people.

## Code TODOs (not done)

- Add a small Overpass fetch helper for glaciers (User-Agent, mirrors, remark
  check, hash) so phase 2 is one command instead of curl.
- Allow per-place description source name and license; the manifest has one
  pair for every place today.
