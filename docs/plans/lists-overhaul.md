# Lists Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make curated lists the heart of Peaks: a full classic-list catalog with real metadata, and a web list experience with a map hero, per-peak completion, stats, and photography.

**Architecture:** Three workstreams on one branch (`lists`, off `647b5f7`). (1) Schema: first-ever `ALTER TABLE lists` adds metadata columns, threaded importer → API → web. (2) Data: research-backed metadata/description backfill for the 17 existing lists; destination gap-fill unblocks the four held classics; new classic lists imported via the existing fail-closed peakbagger importer; Wikimedia hero-image backfill over all list members. (3) Web: list detail gets a map hero, a completion-aware roster, real topline stats, and thumbnails; index and cards get metadata and imagery.

**Tech Stack:** Next 15.5.23 App Router + Tailwind v4 tokens, `node:test`, Postgres/PostGIS via `pg`, Leaflet (vanilla `L.*`), Wikipedia/Wikidata/Commons APIs, Peakbagger as list source.

**Spec:** Design approved in chat 2026-08-20 (map hero, per-peak checkmarks + dates, thumbnails via Wikimedia `hero_image`, real stats, metadata incl. formation year, "ALL the classic lists people would use Peaks for"). No separate spec file; this header plus Global Constraints is the spec of record.

**Cost:** $0/month. Scripts + existing infra only; no new services, no min-instances, no storage (hero images are hotlinked Commons URLs, same as today).

## Global Constraints

- Design-token laws (`web/docs/design-tokens.md`): no box-in-box; never box a stat; whitespace between sections (`space-y-12`); color via the 13 tokens only, never `dark:` variants; radius only `rounded-ctl`/`rounded-media`/`rounded-full`; `shadow-float` for floating chrome only; accent budget (teal never on stat values/headings/backgrounds); Geist weights 400/500 only; every numeral `font-mono-num`; StatCluster labels sentence-case.
- Maps: accent hex `#46ADBC` hard-coded in map files (sanctioned exception); popups build DOM nodes via `map-popups.ts`, never HTML strings; JSON-serialize props for effect deps; the `fitView → requestAnimationFrame(invalidateSize → fitView)` re-measure dance; `ssr:false` needs a one-file client shim; container owns `rounded-media relative isolate overflow-hidden`.
- Per-user data: uid comes from `verifyToken(token)`, never a caller argument.
- Images: plain `<img>` + `// eslint-disable-next-line @next/next/no-img-element` (next/image allowlists only firebasestorage). Missing image ⇒ render nothing (never-null law), no placeholder tile.
- New web pure-logic tests only at `web/src/lib/*.test.ts`, `web/src/lib/__tests__/*.test.ts`, or `web/src/components/*.test.ts` (the `node --test` globs cover nothing else).
- New page-level fetches on `lists/[id]` must be `cache()`-wrapped in `cached-lists.ts` (layout refetches for JSON-LD); related-data reads wrapped in `settled(...)`.
- Schema changes: dated `cloud-sql/migrations/YYYYMMDD_<name>.sql` with `IF NOT EXISTS`, folded into `schema.sql` in the same commit; DDL applied to prod manually via `psql -U postgres` over the proxy; must survive `test-db/provision.sh` without extending its skip list.
- Importer is fail-closed: every list in `CURATED_LISTS` must be present in the `--input` JSON at its exact `expectedCount`, and every row must resolve to exactly one catalog destination, or the whole run aborts. Destinations must carry the `summit` feature to be visible to it.
- Add missing summits via the curated-migration precedent (`20260720_snoqualmie_pass_summits.sql` shape: OSM-node sha256 ids, PointZ with matching scalar elevation, 500 m + OSM-id dedup guard). Never bulk-load through `CURATED_DESTINATIONS`.
- Verification: `cd web && npm run build && npm run lint && npm test`; `cd cloud-sql/migrate && npm test`; `cd cloud-sql/api && npm run build && npm run lint && npm test`. Lint runs separately from build (`ignoreDuringBuilds: true`).
- Every data-audit doc ends with an explicit monthly cost impact line.
- Prod DB: proxy at `127.0.0.1:5432`; DDL as `postgres` (password: Secret Manager `peaks-db-postgres-password`); scripts run DML as `peaks-api` (secret `peaks-db-password`, project `donner-a8608`).

---

## Phase 1 — Schema + metadata plumbing

### Task 1: `lists` metadata columns end to end

**Files:**
- Create: `cloud-sql/migrations/20260821_list_metadata.sql`
- Modify: `cloud-sql/schema.sql` (lists table, ~line 219)
- Modify: `cloud-sql/api/src/routes/lists.ts` (SELECTs at lines 13, 37, 54, 151), `cloud-sql/api/src/routes/destinations.ts:456`
- Modify: `web/src/lib/actions/lists.ts` (ListRow interface :16, SELECTs :72 and :98, mappers :85/:112), `web/src/app/sitemap.ts` (only if its list query names columns)
- Test: extend `cloud-sql/api/src/__tests__/list-destinations-enrichment.test.ts` pattern if a pure query builder changes; web types are compile-checked

**Interfaces:**
- Produces: columns `year_established INT`, `organization TEXT`, `source_name TEXT`, `source_url TEXT`, `region TEXT` on `lists`; `ListRow` gains `year_established: number | null; organization: string | null; source_name: string | null; source_url: string | null; region: string | null`; all list API responses carry the same five fields (additive — iOS ignores unknown keys).

- [x] **Step 1: Write the migration**

```sql
-- 20260821_list_metadata.sql
-- Curated-list metadata. year_established is the year the list (or the club
-- that keeps it) was created — a display fact, not a data lineage field.
-- source_name/source_url replace the trailing "Source: <url>" clause that
-- importer descriptions used to carry (web/src/lib/list-content.ts parses the
-- legacy clause; new rows keep description as pure prose).
-- region is a display grouping label ("Colorado", "Northeast US"), not a
-- normalized geography — derive rigorous geography from members' state_code.
BEGIN;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS year_established INT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS region TEXT;
COMMENT ON COLUMN lists.year_established IS 'Year the list or its keeper organization was established; display fact';
COMMENT ON COLUMN lists.source_url IS 'Authoritative source page for membership (e.g. peakbagger list.aspx)';
COMMIT;
```

- [x] **Step 2:** Fold the same five columns into `CREATE TABLE lists` in `schema.sql` (same commit).
- [x] **Step 3:** Thread the five columns through the four `api/src/routes/lists.ts` SELECTs + `destinations.ts:456`, and through `web/src/lib/actions/lists.ts` (interface, both SELECTs, both mappers). `getListDestinations` is untouched here.
- [x] **Step 4:** Run `cd cloud-sql/api && npm run build && npm run lint && npm test`; `cd web && npm run build && npm run lint && npm test`. Expected: green (fields flow, nothing consumes them yet).
- [x] **Step 5:** Apply DDL to prod: `PGPASSWORD=$(gcloud secrets versions access latest --secret=peaks-db-postgres-password) psql "host=127.0.0.1 port=5432 dbname=peaks user=postgres" -f cloud-sql/migrations/20260821_list_metadata.sql`. Verify with `\d lists`.
- [x] **Step 6:** Commit: `data: add curated-list metadata columns (year, organization, source, region)`.

### Task 2: Metadata + description backfill for the existing 17 lists

**Files:**
- Create: `cloud-sql/migrations/20260821_list_metadata_backfill.sql`
- Create: `docs/data-audits/list-metadata-2026-08-21.md`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: all 17 prod lists carry researched `year_established` (nullable where genuinely unknowable), `organization`, `source_name`, `source_url`, `region`, and a real 2–3 sentence `description` (pure prose, no trailing Source clause, no literal `\n` escapes, no boilerplate sentence, no raw URLs in body copy).

- [x] **Step 1:** Research each of the 17 lists (web search; peakbagger/club sites): formation year, keeper org (e.g. AMC Four Thousand Footer Club, Mazamas, Sierra Club Angeles Chapter SPS), canonical source URL, region label, and a factual description (what the list is, criteria, why it matters). Record findings + source links in the audit doc. Fix the known content bugs: "Kosiuszko" typo, "Ultras Of Iran" capitalization, the 10 byte-identical boilerplate descriptions, the 5 descriptions that print raw peakbagger URLs.
- [x] **Step 2:** Write the backfill as one migration of `UPDATE lists SET ... WHERE id = '<id>'` statements (ids are stable; see the 17 in `docs/data-audits/peakbagger-lists-2026-08-18.md` + prod). Header comment cites the audit doc.
- [x] **Step 3:** Apply to prod via `psql -U postgres -f`; verify `SELECT name, year_established, organization, region FROM lists ORDER BY name` shows no NULL organization/source_url and descriptions read as prose.
- [x] **Step 4:** Audit doc ends with "Monthly cost impact: $0." Commit both files: `data: backfill metadata + real descriptions for the 17 curated lists`.

### Task 3: Importer support for metadata + prose descriptions

**Files:**
- Modify: `cloud-sql/migrate/src/import-peakbagger-lists.ts` (`CuratedList` interface, `CURATED_LISTS`, the `INSERT INTO lists ... ON CONFLICT DO UPDATE`)
- Test: `cloud-sql/migrate/src/__tests__/import-peakbagger-lists.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `CuratedList` gains `yearEstablished: number | null; organization: string; sourceName: string; sourceUrl: string; region: string; description: string` (description now pure prose — the importer stops appending `" Source: https://..."`; `sourceUrl` carries it). The lists INSERT writes/updates all five columns. Existing 17 `CURATED_LISTS` entries get their researched values from Task 2's audit doc so a re-run is idempotent with the backfill.

- [x] **Step 1:** Write failing tests: (a) the INSERT plan for a curated list includes the five metadata values; (b) description contains no `Source:` clause; (c) re-import of an unchanged list is a no-op diff. Run `cd cloud-sql/migrate && npm test` — expect the new cases to fail.
- [x] **Step 2:** Implement; re-run tests to green.
- [x] **Step 3:** Dry-run against prod with the existing candidates file: `npm run import:peakbagger-lists -- --input=/private/tmp/peakbagger-list-candidates.json`. Expected: plan output with metadata, zero adds/removes on membership.
- [x] **Step 4:** Commit: `data: importer writes list metadata; descriptions become pure prose`.

## Phase 2 — Web experience (independent of Phases 3–4 after Task 1)

### Task 4: List data layer — roster columns + completion action

**Files:**
- Modify: `web/src/lib/actions/lists.ts`, `web/src/lib/actions/cached-lists.ts`
- Create: `web/src/lib/list-stats.ts`, `web/src/lib/list-stats.test.ts`

**Interfaces:**
- Produces:
  - `ListDestination` gains `hero_image: string | null; state_code: string | null` (SELECT at `lists.ts:132` adds `d.hero_image, d.state_code`).
  - `export interface ListCompletionEntry { reached_at: string | null; visit_count: number }`
  - `export async function getListCompletion(token: string, listId: string): Promise<Record<string, ListCompletionEntry>>` — uid from `verifyToken`; SQL:
    ```sql
    SELECT ld.destination_id,
           COUNT(DISTINCT sd.session_id) AS visit_count,
           MAX(ts.start_time)            AS reached_at
    FROM list_destinations ld
    JOIN session_destinations sd
      ON sd.destination_id = ld.destination_id AND sd.relation = 'reached'
    JOIN tracking_sessions ts
      ON ts.id = sd.session_id AND ts.user_id = $2
    WHERE ld.list_id = $1
    GROUP BY ld.destination_id
    ```
    (`reached_at` is the session start date — `session_destinations` stores no summit time; same convention as `getUserDestinationActivity`.)
  - `web/src/lib/list-stats.ts`: `export interface ListToplineFacts { count: number; highestFt: number | null; highestName: string | null; states: number }` and `export function buildListToplineFacts(destinations: Array<{ name: string | null; elevation: number | null; state_code: string | null }>): ListToplineFacts` (pure; feet via `* 3.28084`, rounded in UI only).

- [x] **Step 1:** Write `list-stats.test.ts` (node:test): empty roster → zeros/nulls; mixed null elevations; distinct-state counting; highest picks max elevation with its name. Run `cd web && npm test` — expect fail.
- [x] **Step 2:** Implement `list-stats.ts`; tests green.
- [x] **Step 3:** Add the SELECT columns + `getListCompletion` (follow `getListProgress`'s auth shape exactly). Keep `getListProgress` for now (removed in Task 6).
- [x] **Step 4:** `npm run build && npm run lint && npm test` green. Commit: `web: list roster columns, completion action, topline facts`.

### Task 5: List map + hero

**Files:**
- Create: `web/src/components/list-map.tsx`, `web/src/components/list/list-map-embed.tsx`, `web/src/components/list/list-hero.tsx`
- Test: reuse of `map-popups.ts` keeps XSS coverage; no new pure logic expected

**Interfaces:**
- Consumes: `ListDestination[]` (lat/lng may be null — filter), completion ids from Task 6's context.
- Produces:
  - `list-map.tsx` (`"use client"`, vanilla `L.*`, modeled on `plan-map.tsx`): `export interface ListMapMarker { id: string; name: string | null; lat: number; lng: number; completed: boolean }`, `export default function ListMap({ markers, className }: { markers: ListMapMarker[]; className?: string })`. OpenTopoMap tiles + attribution verbatim from `destination-map.tsx:61-64`; `L.circleMarker` radius 5, completed → `fillColor "#46ADBC"`, remaining → `fillColor "#ffffff", color "#46ADBC"` (outline-only reads as "not yet"); popups via `detailLink` to `/destinations/{id}`; `fitBounds(bounds.pad(0.12), { maxZoom: 12 })` + the re-measure dance; JSON-serialized effect deps.
  - `list-map-embed.tsx`: the 15-line `ssr:false` shim, exactly the `destination-map-embed.tsx` shape.
  - `list-hero.tsx` (`"use client"`): `ListHero({ destinations, className }: { destinations: ListDestination[]; className?: string })` — slab `h-[260px] sm:h-[320px] lg:h-[380px] rounded-media relative isolate overflow-hidden` (heights from `destination-hero.tsx`), map fills it, `z-[750]` bottom scrim per `area-hero.tsx`; reads completion from Task 6's `useListCompletion()` to set `completed` per marker (empty map for signed-out). Renders null when <2 markers have coords.

- [x] **Step 1:** Build the three files against the patterns above (Task 6 provides the context hook; stub `completed: false` until it lands if built first).
- [x] **Step 2:** Verify in the browser (dev server via launch.json): `/lists/DOlya3YYfIg60trgTm0n` (Bulger, 100 markers) — bounds fit WA, no world-zoom flash, popups navigate; console clean.
- [x] **Step 3:** `npm run build && npm run lint` green. Commit: `web: list map hero`.

### Task 6: Completion provider + roster

**Files:**
- Create: `web/src/components/list/list-completion-context.tsx`, `web/src/components/list/list-roster.tsx`
- Delete (in Task 7 wiring): usage of `list-progress.tsx`, `list-destinations.tsx`

**Interfaces:**
- Consumes: `getListCompletion`, `ListDestination[]`, `TrophyGlyph` (`session/activity-glyph.tsx:68`), `ProgressBar`, `formatShortDate` (`destination-detail.ts:434`), `formatFeetValue`/`titleize` (`lib/destination-detail`).
- Produces:
  - `list-completion-context.tsx` (`"use client"`): `ListCompletionProvider({ listId, children })` — one fetch per page view, `useAuth()` + `getIdToken()` + `getListCompletion` in an effect keyed on primitives (`[authLoading, listId, userId]`), exposes `useListCompletion(): { entries: Record<string, ListCompletionEntry> | null; signedIn: boolean }`. Server children pass through as `{children}`.
  - `list-roster.tsx` (`"use client"`): `ListRoster({ destinations }: { destinations: ListDestination[] })` — `SectionHeading` "Destinations (N)"; signed-in: a progress line above the rows (`ProgressBar completed={Object.keys(entries).length} total={N} max-w-sm`); rows keep the `list-destinations.tsx` link shape and add: leading 48px thumbnail (`hero_image ? <img className="h-12 w-12 shrink-0 rounded-full bg-fill object-cover" alt="" /> : null` per `destination-nearby.tsx:50-57`), and for completed rows a trailing `TrophyGlyph h-4 w-4 text-muted` + `formatShortDate(reached_at)` in `text-[13px] text-muted` (mirror `session-achievements.tsx`). Signed-out renders rows without marks. Empty state text unchanged.

- [x] **Step 1:** Build provider + roster. Client components still SSR — destination links stay in the HTML.
- [x] **Step 2:** Browser-verify signed-out (rows + thumbnails, no marks) and signed-in as Josiah (Bulger progress + trophies with dates; spot-check a known summit against the log page).
- [x] **Step 3:** `npm run build && npm run lint && npm test` green. Commit: `web: completion-aware list roster`.

### Task 7: List detail page assembly

**Files:**
- Modify: `web/src/app/(public)/lists/[id]/page.tsx`, `web/src/app/(public)/lists/[id]/layout.tsx`
- Delete: `web/src/components/list/list-progress.tsx`, `web/src/components/list/list-destinations.tsx` (superseded)

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces: page order — `PageHeader` (meta line: `Est. {year} · {organization}` when present, else ownerLabel) → `ListHero` → `Topline` from `buildListToplineFacts` (`Peaks` count / `Highest peak` ft w/ unit `ft` / `States` — omit null/zero facts; keys `peaks`, `highest`, `states`) → about section (paragraphs; source line prefers `source_name`/`source_url` columns, falls back to `parseListDescription`) → `ListRoster`, all inside one `ListCompletionProvider` and `space-y-12`.

- [x] **Step 1:** Rewire the page; wrap `ListHero` + `ListRoster` under the provider; keep `settled()` on the destinations fetch; drop the superseded components.
- [x] **Step 2:** Confirm `layout.tsx` JSON-LD/metadata still compile against the widened `ListDetail`; no new page fetches were added outside `cached-lists.ts`.
- [x] **Step 3:** Browser pass on 3 lists (big/small/description-less): hero, stats, roster, source line; dark scheme via `resize_window`; console clean.
- [x] **Step 4:** `npm run build && npm run lint && npm test` green. Commit: `web: list detail — map hero, stats, metadata, roster`.

### Task 8: Lists index + cards

**Files:**
- Modify: `web/src/lib/actions/lists.ts` (`getLists` SELECT), `web/src/app/(public)/lists/page.tsx`, `web/src/components/list-card.tsx`, `web/src/lib/list-content.ts` (+`web/src/lib/list-content.test.ts`)

**Interfaces:**
- Produces:
  - `ListRow` gains `thumbnails: string[]` via lateral join in `getLists`:
    ```sql
    , ARRAY(
        SELECT d.hero_image FROM list_destinations ld2
        JOIN destinations d ON d.id = ld2.destination_id
        WHERE ld2.list_id = l.id AND d.hero_image IS NOT NULL
        ORDER BY d.elevation DESC NULLS LAST LIMIT 3
      ) AS thumbnails
    ```
    (string arrays arrive as `{...}` — run through the existing `parseArray`.)
  - `list-content.ts` gains `export function listOwnerLabel(owner: string): string` (the string pair currently duplicated at `lists/page.tsx:53`, `lists/[id]/page.tsx:30`, `list-card.tsx:11`) — all three call sites switch to it.
  - Index rows: leading overlap-stack of up to 3 `h-9 w-9 rounded-full` thumbnails (`-space-x-2`, `bg-fill`, `alt=""`), meta line `Est. {year} · {organization}` (fall back to region, then ownerLabel), count stays mono right. `ListCard` (discover) gets the same thumbnail stack + meta line, `Badge` dropped in favor of the meta line.

- [x] **Step 1:** Extend `list-content.test.ts` with `listOwnerLabel` cases; run — fail; implement; green.
- [x] **Step 2:** SQL + UI changes; browser-verify `/lists` and `/discover` (thumbnails appear only where hero images exist — sparse until Phase 3 backfill; that's expected and correct).
- [x] **Step 3:** `npm run build && npm run lint && npm test` green. Commit: `web: lists index + cards — thumbnails and metadata`.

## Phase 3 — Imagery backfill (after Task 1; re-run after Phase 4 imports)

### Task 9: List-scoped Wikimedia hero-image backfill

**Files:**
- Modify: `cloud-sql/migrate/src/backfill-destination-descriptions.ts` (`buildCandidateQuery`, `parseArgs`)
- Test: `cloud-sql/migrate/src/__tests__/backfill-destination-descriptions.test.ts`
- Create: `docs/data-audits/list-hero-images-2026-08-21.md`

**Interfaces:**
- Produces: `--list-id <id>` and `--all-lists` flags. `buildCandidateQuery` gains a branch: candidates = destinations joined through `list_destinations` (all lists or one), `hero_image IS NULL` (unless `--force`), **no prominence floor and no summit-feature requirement** in this branch (list membership is the curation), ordered by elevation desc. Everything else (licensing gate, attribution format, `namesMatch`, 350 ms politeness delay, dry-run default) unchanged.

- [x] **Step 1:** Extend the pure `buildCandidateQuery` tests for both new flags; fail → implement → green (`cd cloud-sql/migrate && npm test`).
- [x] **Step 2:** Dry-run a sample: `npm run backfill:descriptions -- --list-id DOlya3YYfIg60trgTm0n --dry-run --limit 100` (env per Global Constraints, user `peaks-api`). Review matches/misses in the output — Bulger names are exactly the hard case (`namesMatch` must hold).
- [x] **Step 3:** Commit runs list-by-list: `--list-id <id> --commit --limit 150` for each of the 17. ~588 candidates ≈ 25–40 min total wall clock at 4 requests + 1.4 s per row. Record per-list hit/miss/refused counts in the audit doc (licensing refusals are expected and correct).
- [x] **Step 4:** Spot-check 10 random updated rows in prod for attribution completeness (`hero_image_attribution` + url both present) and on `/destinations/{id}` pages. Audit doc ends "Monthly cost impact: $0." Commit: `data: list-scoped hero-image backfill`.
- [x] **Step 5 (deferred to after Task 12):** re-run `--all-lists --commit` so newly imported lists get coverage.

## Phase 4 — Catalog fill-out (after Task 3)

### Task 10: Unblock and import the four held classics

**Files:**
- Create: `cloud-sql/migrations/20260821_held_list_summits.sql`
- Modify: `cloud-sql/migrate/src/import-peakbagger-lists.ts` (`CURATED_LISTS` entries for lids 5120, 5163, 21316, 50083; `destinationOverrides` as needed)
- Create: `docs/data-audits/peakbagger-lists-2026-08-21.md` (continuation of the 08-18 doc)

**Interfaces:**
- Consumes: `/private/tmp/peakbagger-list-candidates.json` (already contains all four at full row counts; copy it into `docs/data-audits/` fixtures or regenerate — it is in /tmp and mortal). ADK 46ers (5120) and Traditional CO Centennials (50083) rows carry lat/lng; AMC NE 67 (5163) and OR Top 100 (21316) do not — ambiguities there need `destinationOverrides`.
- Produces: four new prod lists with metadata; ~41 new summit destinations.

- [x] **Step 1:** Add the four `CURATED_LISTS` entries (deterministic ids via `deterministicListId`, metadata per Task 3 shape, researched like Task 2). Dry-run the importer; collect every `resolved to N destinations` / missing-peak failure — that enumeration IS the gap list (~9 ADK + ~16 NE + ~12 OR + ~4 CO, minus overlap).
- [x] **Step 2:** For each gap peak: resolve the OSM node (Nominatim/OSM per repo rule — never GNIS coordinates), elevation (OSM/USGS EPQS with per-row provenance), state/country codes. Write the curated migration in the exact `20260720_snoqualmie_pass_summits.sql` shape (sha256 OSM-node ids, PointZ Z = scalar elevation, `WHERE NOT EXISTS` osm-id + 500 m name guard, per-row provenance comments, intentional exclusions noted).
- [x] **Step 3:** Apply migration to prod (`psql -U postgres -f`); fold nothing into schema.sql (data-only). Re-dry-run the importer until all four lists resolve clean (add `destinationOverrides` for name/elevation ambiguities; document each in the audit doc).
- [x] **Step 4:** `npm run import:peakbagger-lists -- --input=<file> --apply`. Verify in prod: 21 lists, member counts 46/67/100/100.
- [x] **Step 5:** `cd cloud-sql/migrate && npm test` green; audit doc updated (cost line); commit: `data: import ADK 46ers, AMC NE 4000-footers, OR Top 100, CO Centennials + gap summits`.

### Task 11: New classics — research, export, import (two batches)

**Files:**
- Create: `docs/data-audits/classic-lists-2026-08-21.md`, candidate JSON fixtures under `docs/data-audits/fixtures/`
- Create: `cloud-sql/migrations/20260821_classic_list_summits.sql` (or one per batch)
- Modify: `cloud-sql/migrate/src/import-peakbagger-lists.ts` (`CURATED_LISTS`)

**Interfaces:**
- Consumes: Peakbagger list pages (public HTML tables at `peakbagger.com/list.aspx?lid=<id>`), fetched and parsed into the importer's input dialect (`{ meta, rows: [{ordinal, peakbaggerPeakId, name, elevationFt, lat?, lng?}] }`).
- Produces: these lists live in prod with metadata — **Batch A (Northeast):** NH 4000-Footers (48), Catskill 3500 (the club's required peaks), New England Hundred Highest, Northeast 111. **Batch B (West/South):** Sierra Peaks Section full list, Desert Peaks Section, Hundred Peaks Section, Tahoe Ogul, South Beyond 6000, Idaho 12ers. Verify each lid on peakbagger during research — do not trust remembered ids. Inclusion rule (from the 08-18 audit, unchanged): official org/guidebook lists with real completion culture; skip grids, county highpoints, near-copies (the Alpine Lakes duplicates and modern-vs-traditional Centennial variants already adjudicated on 08-18 stay excluded). Munros and other non-US classics: explicitly deferred — the catalog has no UK coverage; flag as a future product call in the audit doc.

- [x] **Step 1 (per batch):** Research each list (lid, expectedCount, membership snapshot date, metadata per Task 2). Build the candidates JSON; store as a fixture with a header note naming the fetch date.
- [x] **Step 2 (per batch):** Dry-run → enumerate gaps → curated summit migration (same shape/guards as Task 10) → apply → re-dry-run → `--apply`. HPS (~280 SoCal peaks) is the likely big-gap case: if its gap list exceeds ~60 destinations, hold HPS with a note (same "held" mechanism as 08-18) rather than bulk-adding under time pressure, and say so in the audit doc.
- [x] **Step 3:** After both batches: `cd cloud-sql/migrate && npm test`; prod count check (expected ~29–31 lists); re-run Task 9 Step 5 (`--all-lists --commit`) for imagery on the new members; audit doc complete with cost line. Commit per batch: `data: import Northeast classics` / `data: import Western classics`.

Completion note, 2026-08-22: the full Sierra Peaks Section (247) and Hundred
Peaks Section (280) are live. Peaks now has 31 lists and 1,596 distinct listed
destinations. All 1,596 have a live cover or a pending, crop-reviewed candidate.

### Task 12: Wrap-up — verification sweep and PR

**Files:**
- Modify: `docs/plans/lists-overhaul.md` (check off), memory files (outside repo)

- [x] **Step 1:** Full verification: web build/lint/test, migrate test, api build/lint/test; browser pass over `/lists`, three detail pages (one new-import, e.g. ADK 46ers), `/discover`.
- [x] **Step 2:** Confirm iOS-facing API unchanged in shape (new fields additive) by hitting `GET /api/lists/:id` + `/:id/destinations` against local api or prod rev.
- [x] **Step 3:** Push branch `lists`, open PR (body: what shipped, prod DDL/data already applied and idempotent on merge, cost line $0/mo). Monitor CI green per repo rule.
- [ ] **Step 4:** Update memory: lists-overhaul state note; retire the "thought we had more than 17" mystery (answer: held imports, now landed).

---

## Task order

1 → 2 → 3 → {4 → 5/6 → 7 → 8 (web)} ∥ {10 → 11 (data)}; 9 after 1 (re-run after 11); 12 last. Tasks 5 and 6 may build in either order (5 stubs the hook if first).

## Self-review notes

- Spec coverage: metadata incl. formation year (T1–3), classics fill-out incl. held four (T10–11), map hero + per-peak completion + stats + thumbnails (T4–8), imagery (T9), "wrong place" mystery resolved (audit doc, T12). Sitemap/JSON-LD guarded (T1/T7). Boilerplate-description dead code: `isBoilerplateListDescription` stays until community-owned lists exist server-side clean; removal noted for the dead-code follow-up batch, not this plan.
- Type consistency: `ListCompletionEntry`/`getListCompletion` named identically in T4/T6/T7; `ListMapMarker.completed` fed by `useListCompletion` (T5/T6); `thumbnails: string[]` only on `ListRow` (T8).
- No placeholders: every task carries exact files, signatures, SQL, and verification commands.
