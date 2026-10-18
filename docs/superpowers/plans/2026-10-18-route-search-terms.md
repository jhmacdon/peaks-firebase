# Route Search Terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route search answers from a narrow, trigger-maintained `route_search_terms` table instead of fuzzy-matching fat `routes`/`segments` rows, so `/api/search/all` stays well under 1 s on the db-f1-micro as the catalog grows.

**Architecture:** One row per (active route, searchable term) holds the same terms today's query gathers at search time: route name, aliases, objective and linked destination names, and segment trail names. A trigram index finds candidate routes; scoring reads only narrow rows; a shortlist then joins `routes` by primary key, where status and access are rechecked on the real row. Response shape and ranking weights stay the same.

**Tech Stack:** PostgreSQL 15 + pg_trgm, TypeScript/Express API, node:test.

**Spec:** this conversation's agreed design (2026-10-18 search outage audit). Evidence: on production, the narrow-table match for "maple pass" took 15 ms against 0.7 s warm / 3.8–60 s cold for today's route query.

## Global Constraints

- All schema objects owned by `postgres`; migration runs as `postgres`. `peaks-api` keeps DML only.
- Maintenance functions are `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp` and schema-qualify every call (`public.peaks_search_name`), so any writer role and autovacuum work (see PR #239).
- Text-score weights, popularity and proximity formulas come from `api/src/lib/search-ranking.ts` unchanged.
- The response shape of `/api/search/all` and `/api/search` does not change. No iOS release.
- Added fixed cost: ~$0/month (one ~10 MB table and its indexes on the existing instance).

## Review Focus

1. **A private destination's name must not surface a route to signed-out callers.** Today the lateral filters destination terms with `publicCatalogSql`; the table carries `public` per term and the query filters on it. Test in Task 2.
2. **Stale narrow data must never show a pending, retired, or someone else's private route.** The final stage rechecks `r.status = 'active'` and `buildRouteAccessSql("r", "$5")` on `routes`. Test in Task 2 (pending route whose terms were left behind by a direct `INSERT`).
3. **Trail-name and destination-name edits reach search without a reload.** Triggers on `segments.trail_names` and `destinations.search_name/owner`. Test in Task 1.
4. **Bulk catalog loads still work under the `peaks-route-factory` and `postgres` roles.** SECURITY DEFINER covers it; Task 1 test inserts through the normal path, and Task 4 times a 200-route insert.
5. **Two-letter queries ("mt", "br") keep token-prefix behavior.** Test in Task 2 via the existing golden "later aliases and trail names match short token prefixes" case.

---

### Task 1: `route_search_terms` table, maintenance triggers, backfill

**Files:**
- Create: `cloud-sql/migrations/20261019_route_search_terms.sql`
- Test: `cloud-sql/api/src/__tests__/route-search-terms.integration.test.ts`

**Interfaces:**
- Produces table `route_search_terms(route_id text NOT NULL REFERENCES routes(id) ON DELETE CASCADE, term text NOT NULL, public boolean NOT NULL, owner text NOT NULL, popularity double precision)`, unique on `(route_id, term, public)`.
- Indexes: `USING gin (term gin_trgm_ops)`, `USING gin (to_tsvector('simple', term))`, btree `(route_id)`.
- Produces `refresh_route_search_terms(route_ids text[]) RETURNS void`: deletes the given routes' rows, then inserts DISTINCT terms for those that are `status = 'active'`, skipping NULL/empty terms. Terms and `public`:
  - `routes.search_name` → public true
  - `public.peaks_search_name(alias)` for each `aliases` entry → true
  - objective destination `search_name` → `d.owner = 'peaks'`
  - each `route_destinations` destination `search_name` → `d.owner = 'peaks'`
  - `public.peaks_search_name(trail_name)` for each trail name of each linked segment → true
  - `owner`, `popularity` copied from the route row.
- Triggers (all call `refresh_route_search_terms`):
  - `routes` AFTER INSERT FOR EACH ROW; AFTER UPDATE OF status, owner, popularity, search_name, aliases, objective_destination_id FOR EACH ROW WHEN any of those is distinct.
  - `route_destinations`, `route_segments`: statement-level AFTER INSERT / AFTER DELETE / AFTER UPDATE, one trigger per event, using transition tables; refresh the distinct `route_id`s.
  - `segments` AFTER UPDATE OF trail_names FOR EACH ROW WHEN distinct → routes linked through `route_segments`.
  - `destinations` AFTER UPDATE OF search_name, owner FOR EACH ROW WHEN distinct → routes with that objective or a `route_destinations` link.
- `GRANT SELECT ON route_search_terms TO "peaks-api"`.
- Migration ends with a backfill: `SELECT refresh_route_search_terms(array_agg(id)) FROM routes WHERE status = 'active'`.

- [ ] **Step 1: Write the failing test** `route-search-terms.integration.test.ts` (skip on `dbSkipReason`, one rolled-back transaction, fixture ids prefixed with a UUID). Assertions:
  - an inserted active route with name "Maple Pass Loop" and alias "Heather Maple" has terms `maple pass loop` and `heather maple`, both `public = true`;
  - inserting a `route_segments` link to a segment with `trail_names = ['Pacific Crest Trl']` adds `pacific crest trail`;
  - updating that segment's `trail_names` to `['Rainy Lake Trl']` replaces it with `rainy lake trail`;
  - an objective destination owned by another user gives its term `public = false`; updating that destination's owner to `peaks` flips it to true;
  - `UPDATE routes SET status = 'pending'` removes all of the route's rows; setting it back restores them;
  - `UPDATE routes SET popularity = 42` updates `popularity` on every row of the route;
  - deleting the route removes its rows.
- [ ] **Step 2: Run it and confirm it fails** — `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/route-search-terms.integration.test.ts` with `TEST_DATABASE_URL` set. Expected: `relation "route_search_terms" does not exist`.
- [ ] **Step 3: Write the migration** described in Interfaces, as `postgres`, in one transaction; header comment states the cost line.
- [ ] **Step 4: Apply to `peaks_test`** as `postgres` (`psql -v ON_ERROR_STOP=1 -f`), rerun the test. Expected: PASS.
- [ ] **Step 5: Commit** migration and test.

### Task 2: Route search query reads `route_search_terms`

**Files:**
- Modify: `cloud-sql/api/src/routes/search.ts:373-498` (`buildRouteSearchQuery`)
- Modify: `cloud-sql/api/src/__tests__/search-route.test.ts` (SQL-shape assertions for the route query, currently lines ~200-290)
- Modify: `cloud-sql/api/src/__tests__/search-golden.integration.test.ts` (add private/pending cases)

**Interfaces:**
- Consumes: Task 1 table and columns.
- Keeps `buildRouteSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery`, its parameter order (`$1` q, `$2` prefix, `$3` substring or token query, `$4` limit, `$5` uid, `$6`/`$7` lat/lng) and its output columns exactly.
- Query stages:
  1. `matched_route_ids` — DISTINCT `route_id` from `route_search_terms t` where the term matches (`to_tsvector('simple', t.term) @@ to_tsquery('simple', $3::text)` for two-letter queries; `t.term % $1 OR t.term %> $1 OR t.term LIKE $3` otherwise) and, when `publicOnly`, `t.public`.
  2. `scored_routes` — per matched route, over all its terms (same `public` filter): `max(searchTextScoreSql("t.term", "$1", "$2")) AS text_score`, `bool_or(t.term = $1) AS exact_match`, `min(t.owner) AS owner`, `max(t.popularity) AS popularity`; column `route_id` exposed as `id`.
  3. `shortlist` — `scored_routes s` filtered by `buildRouteAccessSql("s", "$5")`, ordered by `text_score + searchPopularityScoreSql("s.popularity")` DESC, `id`, `LIMIT Math.min(500, Math.max(100, input.limit * 10))`.
  4. `ranked_routes` — `shortlist s JOIN routes r ON r.id = s.id` with `r.status = 'active' AND buildRouteAccessSql("r", "$5")`; score = `s.text_score + searchPopularityScoreSql("r.popularity") + proximity`. (Changed during Task 3: proximity measures to `route_search_terms.anchor`, the path's start point, added by `20261019_route_search_terms_anchor.sql`; geodesic distance to whole paths cost ~13 ms per route.); `term_exact_match` = `s.exact_match`; ORDER BY score DESC, r.name, r.id LIMIT `$4`.
  5. Final select, cover join and area join unchanged.
- Remove the `indexed_destination_candidates`, `candidate_route_ids`, `visible_candidate_route_ids` CTEs and the per-route `matched_terms` lateral.

- [ ] **Step 1: Update `search-route.test.ts` route-query assertions** to the new shape: matches `/FROM route_search_terms t/`, `/t\.term % \$1 OR t\.term %> \$1 OR t\.term LIKE \$3/` (long), `/to_tsvector\('simple', t\.term\) @@ to_tsquery\('simple', \$3::text\)/` (two-letter), `/AND t\.public/` only when `publicOnly`, `/r\.status = 'active'/` and the route access SQL on `r` in the final stage; does not match `/peaks_search_names\(/` or `/candidate_route_ids/`.
- [ ] **Step 2: Add golden cases** in `search-golden.integration.test.ts`: (a) a route whose only matching term is an objective owned by another user is absent for `publicOnly` and present for that owner; (b) a `pending` route with a manually inserted `route_search_terms` row is absent.
- [ ] **Step 3: Run both files; confirm the new assertions fail** and the old golden cases still pass on the old code.
- [ ] **Step 4: Rewrite `buildRouteSearchQuery`** per Interfaces.
- [ ] **Step 5: Run** `search-route`, `search-golden.integration`, `search-sql.integration`, `search-ranking`, `route-search-terms.integration`. Expected: all PASS, including every pre-existing golden ordering case.
- [ ] **Step 6: Commit.**

### Task 3: Production parity and timing check (read-only)

**Files:**
- Create: `cloud-sql/api/scripts/compare-route-search.ts` — for each query in a list, runs the old route SQL (built from `origin/main`'s `buildRouteSearchQuery`, vendored into the script as `legacyBuildRouteSearchQuery`) and the new one on one connection, reporting top-20 id lists, any order differences, and both execution times.

- [ ] **Step 1:** Apply Task 1's migration to production as `postgres` after an on-demand backup (`gcloud sql backups create --instance=peaks-db --project donner-a8608`). The table is additive; the old code ignores it.
- [ ] **Step 2:** Run the script against production as `peaks-api` with these queries, signed in and signed out, with and without the Seattle point (47.642, -122.351): `maple pass`, `maple`, `map`, `mt`, `rainier`, `mount si`, `mailbox peak`, `ingalls`, `lake serene`, `snow lake`, `colchuck lake`, `enchantment`, `pct`, `pacific crest`, `wonderland`, `lake`, `trail`, `mount`, `br`, `heather maple pass loop`.
- [ ] **Step 3:** Expected: identical top-20 ids and order for every query, except where both scores tie within 0.0005; new time under 150 ms warm for each. Record the table in the PR. Any other difference blocks Task 4 until explained.

### Task 4: Ship

- [ ] **Step 1:** Run the full API suite with `TEST_DATABASE_URL` (`npm run test:db`) and `npm run build`.
- [ ] **Step 2:** Time a 200-route insert with segments and destination links in `peaks_test` before and after the migration; report the difference in the PR.
- [ ] **Step 3:** Update `cloud-sql/CLAUDE.md` "Trail catalog metadata and search": route search reads `route_search_terms`, which triggers maintain; list the trigger sources; bulk writers need nothing extra.
- [ ] **Step 4:** Push, open the PR, get an opus whole-branch review, fix findings, merge. CI deploys `peaks-api` on push to `main`.
- [ ] **Step 5:** Verify the live service: the deploy run succeeded, the new revision serves, and `/api/search/all` for the Task 3 queries returns 200 in under 1 s end to end. Check Cloud Run logs for `Mixed search failed` over the next hour.
