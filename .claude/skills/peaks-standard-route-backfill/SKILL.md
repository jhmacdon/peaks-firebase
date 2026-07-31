---
name: peaks-standard-route-backfill
description: Audit Peaks Cloud SQL for summits on curated climbing lists that lack an active Peaks-owned standard route, research the accepted route with cited sources, rank safe backfill batches, and prepare route-import handoffs. Use when finding standard-route gaps by state or list, checking route coverage, researching normal routes, reviewing user-owned route geometry as a standard-route lead, or preparing GPX route backfills for Peaks.
---

# Peaks Standard Route Backfill

Use for `/Users/josiahm/projects/peaks/firebase`.

This skill finds list peaks without a route that the app can show as standard, then researches a small, cited batch. Keep discovery and research read-only. Import or activate routes only when the user asks.

## Current Route Rule

Read `cloud-sql/api/src/routes/lists.ts` before each audit. At present, a destination has a current standard route only when a linked route has:

```sql
r.owner = 'peaks' AND r.status = 'active'
```

When more than one route qualifies, the list API selects the route with the most `session_routes`, then the shortest one-way distance, then the lowest route id.

Cloud SQL is authoritative. Do not use Firestore route counts to confirm a gap. A user-owned route may appear in recordings or other endpoints but cannot serve as the list standard.

## Workflow

1. Audit current gaps.
   - Start or reuse the Cloud SQL Auth Proxy on `127.0.0.1:5432`.
   - Run the bundled read-only audit:

```bash
bash .claude/skills/peaks-standard-route-backfill/scripts/audit_missing_standard_routes.sh \
  --state WA \
  --limit 50
```

   - Use `--list "Bulger List"` or another list name/id to narrow the batch.
   - Add `--coverage` to return per-list route coverage instead of candidate rows.
   - Treat `state_code` as catalog metadata, not a boundary test.

2. Confirm each candidate against Cloud SQL just before research.
   - Record the destination id, exact name, list names, coordinates, and elevation.
   - Re-run the standard-route predicate. Drop any peak that gained an active Peaks route since the audit.
   - Note pending Peaks routes and user-owned routes separately. Existing user geometry is a lead, not approval to copy, publish, or change ownership.

3. Research a small, disjoint batch.
   - If the user requests subagents and the runtime allows them, use one read-only audit agent and split research agents by geography or name range.
   - Give every research agent destination ids from the current Cloud SQL audit. Do not let an agent infer missing status from Firestore.
   - Keep source requests sequential per site when rate limits or bot checks are likely.

4. Establish the normal route.
   - Prefer, in order: land-manager pages and climbing ranger reports; Mountaineers route pages; WTA for trail access; then established guide or community sources.
   - Use at least one strong source that names or clearly describes the ascent. Use a second source when the normal route is disputed, technical, or only implied.
   - Distinguish the easiest or normal ascent from a named technical variation. Do not call a route standard just because it has the clearest page.
   - Capture the route name, activity type, grade/class, access point, approach, season or permit limits, and direct source URLs.
   - Read [references/evidence-and-handoff.md](references/evidence-and-handoff.md) for the confidence test and report fields.

5. Rank the handoff.
   - Start with high-confidence routes that have a clear source, clear trailhead, and one accepted line.
   - Give extra weight to peaks on several lists.
   - Flag an existing user route with sessions as a geometry-review lead.
   - Defer peaks with competing normal routes, loose source support, private or closed access, or a technical line that may not fit a single route record.

6. Search public trail geometry.
   - Query the USGS National Digital Trails service around a confirmed gap:

```bash
bash .claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh \
  --destination-id <destination-id> \
  --radius-m 10000
```

   - Add `--format geojson` when the table shows likely trail segments.
   - USGS National Map data is public domain. Keep the source service, originator,
     source feature ids, and requested acknowledgment with any derived route.
   - Treat nearby trail lines as geometry candidates only. Join them in the order
     stated by the normal-route source, and flag any missing climber path,
     cross-country, snow, glacier, or rock section.
   - OpenStreetMap can fill coverage gaps, but its ODbL attribution and
     share-alike terms must travel with derived data. Do not mix OSM geometry into
     a public-domain-only route without recording that license.
   - Search nearby OSM ways separately:

```bash
bash .claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh \
  --destination-id <destination-id> \
  --radius-m 3000
```

   - Add `--format geojson` to retain way geometry and exact OSM way links.
     Keep `OpenStreetMap contributors` attribution and the ODbL link on every
     route that uses those lines.
   - After research fixes the exact contributing ways, pass their ids to the
     candidate builder. This uses the main OSM API and avoids repeating a broad,
     failure-prone Overpass query:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts \
  --destination-id <summit-id> \
  --trailhead-id <trailhead-id> \
  --way-ids <way-id>,<way-id>
```

   - Once research fixes the trailhead, build a connected route candidate:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts \
  --destination-id <summit-id> \
  --trailhead-id <trailhead-id> \
  --radius-m 5000
```

   - This is shortest-path geometry, not proof of the normal ascent. Reject it
     when the contributing way names, grade tags, or map line conflict with the
     written source. Use `--format geojson` only after the summary passes.
   - The builder honors mode-specific pedestrian access over a generic access
     tag and prints every such override. Review those ways instead of treating
     the override as silent approval.
   - Render the GeoJSON and inspect the whole line before any import:

```bash
MAPBOX_TOKEN=<token> cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_map.mts \
  --geojson <candidate.geojson> \
  --output <candidate.png>
```

     The orange marker is the trailhead and the black triangle is the catalog
     summit. Reject wrong summits, straight internal gaps, implausible crossings,
     and route variants that disagree with the written source.
- Before importing OSM-derived geometry, confirm that route provenance,
     attribution, and license fields survive the database, API, apps, and every
     geometry export. If any layer drops them, keep the route as research only.
   - Cache terrain tiles for only the candidate bounds:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts \
  --candidate /path/to/candidate.geojson \
  --output-dir /private/tmp/peaks-route-worker/terrain
```

   - Import a reviewed candidate with the bundled helper. It rechecks list
     membership, endpoints, duplicate routes, OSM source fields, elevation, and
     the live standard-route gap. Dry-run comes first; apply only creates a
     pending route:

```bash
PEAKS_ELEVATION_SOURCE=terrain-cache \
PEAKS_TERRAIN_TILE_CACHE=/private/tmp/peaks-route-worker/terrain \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts \
  --candidate /path/to/candidate.geojson \
  --destination-id <summit-id> \
  --trailhead-id <trailhead-id> \
  --name "<Peak> via <Route>" \
  --source-url mountaineers=https://www.mountaineers.org/...
```

After that dry run passes, repeat the same command with:

```text
--apply --acknowledge-geometry-license --acknowledge-map-review
```

     `--acknowledge-geometry-license` confirms that the stored route and segment
     retain the candidate source rights. `--acknowledge-map-review` confirms
     that a person or agent inspected the rendered line. The helper never
     activates a route.

     For a legacy rebuild, add `--replace-active-route <route-id>` to both
     importer runs. The importer locks and validates that exact Peaks-owned
     active route, then allows the reviewed replacement to stay pending beside
     it. Publication, not import, supersedes the old route.

     When a cliff-side AWS terrain sample creates false drops in an otherwise
     continuous ascent, `--elevation-profile monotonic_ascent` fits a
     nondecreasing profile while keeping the catalog trailhead and summit
     elevations. Use it only for one-way summit geometry when an independent
     route source confirms that the normal line has no material descent and
     its published gain agrees with the fitted net gain. The importer records
     the adjustment in route and segment provenance.

   - Give each pending route to a separate agent using
     `$peaks-osm-route-approval`. That skill fetches cited OSM ways or USGS
     features again and checks the stored line without using the route builder.
     A pass approves the geometry only; rights, route identity, access, and
     segment review still gate activation.

7. Report before any write.
   - Return a table with Peaks id, peak, lists, proposed route, class/grade, access, evidence grade, and sources.
   - State the audit time and the exact missing-route rule.
   - Separate confirmed gaps from unverified or disputed candidates.
   - Report list coverage counts and note overlap between lists.

## Optional GPX and Import Work

Do this only when the user asks to add or import routes.

- Prefer a route trace whose license and download terms allow use. A written route description proves the route name but does not grant GPX rights.
- Verify every GPX starts with XML and contains `<trkpt>` or `<rtept>`. Delete login pages or challenge HTML saved as GPX.
- Validate the trace against the named destination, trailhead, source route, direction, and known distance/gain before import.
- Use the web admin route importer, which saves valid routes as `pending`.
- Review segment matching and route metadata before activation. Never activate a pending route just because import succeeded.
- Do not change a user route to `owner='peaks'` or copy its geometry without a direct request and source review.

The current importer requires a real climb: at least 1,600 m one way, at least 200 m gain, a summit within 250 m of an endpoint, and duplicate checks. Read `web/src/lib/actions/route-import.ts` for the live rules rather than relying on these values if code changed.

For a user trace that the user has authorized for reuse, run the bundled
TypeScript helper with the migrate package's `tsx`. It defaults to a dry run,
recomputes terrain elevations, extracts the trailhead-to-summit line, uses the
web import validator, and can create a pending route:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_user_trace.ts \
  --source-route-id <route-id> \
  --destination-id <destination-id> \
  --name "<Peak> via <Route>" \
  --expected-owner <user-id> \
  --source-url wta=https://www.wta.org/... \
  --apply --acknowledge-trace-rights
```

Never use this helper on another user's trace without that user's direct
authorization. The helper never activates a route.

After map review, run the dry-run geometry and segment-overlap helper:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/review_pending_route.mts \
  --route-id <pending-route-id>
```

Activation requires both explicit flags and is refused when existing segment
overlap needs the admin segment review:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/review_pending_route.mts \
  --route-id <pending-route-id> \
  --activate --acknowledge-map-review
```

## Safety and Data Rules

- Keep the audit transaction read-only with `default_transaction_read_only=on`.
- Do not print database passwords or tokens.
- Do not write production data during discovery or research.
- Do not treat a route description as current trail, road, snow, glacier, or permit status. Check land-manager alerts when the user needs trip planning, not just catalog backfill.
- Route names should identify the peak and accepted line, such as `Eldorado Peak via Inspiration Glacier`.
- Preserve source links in the research handoff so a later importer can verify the same line.

## Utility Script

`scripts/audit_missing_standard_routes.sh` has no package dependencies beyond `psql` and `gcloud`. It fetches the PostgreSQL password only when no database password is already supplied, forces read-only transactions, and emits TSV.

`scripts/find_public_trail_geometry.sh` also requires `curl` and `jq`. It resolves
the destination from read-only Cloud SQL, then queries the public-domain USGS
National Digital Trails ArcGIS service. Table output is best for discovery;
GeoJSON output keeps the full line geometry and source metadata.

`scripts/find_osm_trail_geometry.sh` uses the same read-only destination lookup,
then queries Overpass for nearby paths, footways, and tracks. Its GeoJSON output
keeps exact way links and ODbL metadata. Query one candidate at a time to avoid
overloading the shared Overpass service.

`scripts/build_osm_route_candidate.mts` connects a researched trailhead and
summit across those OSM ways. It refuses distant endpoint snaps, records every
way id, and never writes Cloud SQL. Pass `--way-ids` after discovery for a
repeatable build from exact OSM ways without another Overpass search.

`scripts/import_standard_route_from_osm_candidate.mts` reads that exact
GeoJSON, fetches terrain elevations, checks the live gap and route identity
links, and can create a pending route plus segment with matching provenance.
It requires separate ODbL and map-review acknowledgments for an apply.

`scripts/render_route_candidate_map.mts` samples candidate GeoJSON only for a
static Mapbox review image. It leaves the full candidate geometry unchanged.

Useful checks:

```bash
bash -n .claude/skills/peaks-standard-route-backfill/scripts/audit_missing_standard_routes.sh
bash -n .claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh
bash -n .claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh
bash .claude/skills/peaks-standard-route-backfill/scripts/audit_missing_standard_routes.sh --print-sql
```
