# Viewpoint and Waterfall Destination Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `viewpoint` and `waterfall` as two new values of the `destination_feature` enum, including DB migration, OSM auto-import support, and admin UI options.

**Architecture:** Mirror the recent `landform` feature pattern (commit `1b83a99`). One SQL migration adds both enum values; OSM imports gain Overpass selectors for `tourism=viewpoint` and `waterway=waterfall`; admin dropdowns get two new options. No new tables, columns, or behaviors — pure enum extension.

**Tech Stack:** PostgreSQL 15 + PostGIS, TypeScript, Next.js 16 App Router, OpenStreetMap Overpass API.

**Spec:** `docs/superpowers/specs/2026-04-28-viewpoint-waterfall-destinations-design.md`

**Testing note:** This codebase has no unit-test infrastructure for the affected files. The established verification pattern (used for the `landform` feature) is `npm run build && npm run lint` for `web/` plus a manual smoke test of the OSM import flow. This plan follows that pattern rather than introducing test scaffolding for a pure enum extension.

---

## File Map

**Create:**
- `cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql` — DB migration adding both enum values

**Modify:**
- `cloud-sql/schema.sql:19` — append `'viewpoint', 'waterfall'` to `destination_feature` enum
- `cloud-sql/CLAUDE.md` — enum docs in the Enums section
- `web/CLAUDE.md` — enum docs in the Custom enums section
- `cloud-sql/migrate/src/migrate-destinations.ts:132-141` — extend `mapFeatures` mapping
- `web/src/lib/actions/destinations.ts:470-486` — extend Overpass query
- `web/src/lib/actions/destinations.ts:512-526` — extend `mapFeature` switch
- `web/src/app/admin/destinations/new/page.tsx:50-59` — `ALL_FEATURES` constant
- `web/src/app/admin/destinations/[id]/page.tsx:388` — feature add dropdown array
- `web/src/app/admin/destinations/page.tsx:283-291` — table-row feature dropdown
- `web/src/app/admin/destinations/page.tsx:349-357` — page-level feature filter dropdown
- `web/src/app/admin/routes/new/page.tsx:514-520` — trailhead feature dropdown

---

## Task 1: Database migration and schema

**Files:**
- Create: `cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql`
- Modify: `cloud-sql/schema.sql:19`

- [ ] **Step 1: Create the migration file**

Write `cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql` with the following content:

```sql
-- Add viewpoint and waterfall destination features for vistas and hydrological points of interest.
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'viewpoint';
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'waterfall';
```

- [ ] **Step 2: Update `cloud-sql/schema.sql`**

In `cloud-sql/schema.sql` line 19, replace:

```sql
CREATE TYPE destination_feature AS ENUM ('volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake', 'landform');
```

with:

```sql
CREATE TYPE destination_feature AS ENUM ('volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake', 'landform', 'viewpoint', 'waterfall');
```

- [ ] **Step 3: Apply the migration to the local database**

Pre-condition: Cloud SQL Auth Proxy must be running (`cloud-sql-proxy PROJECT_ID:us-central1:peaks-db &`) and `DB_PASS` set in your shell. If you do not have local DB access, skip steps 3 and 4 and note this in your handoff — the migration will be applied on first deploy by whoever has DB credentials.

Run:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -f cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql
```

Expected output: two `ALTER TYPE` lines (or `NOTICE: enum label "..." already exists, skipping` if re-applied).

- [ ] **Step 4: Verify enum values were added**

Run:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -c "SELECT unnest(enum_range(NULL::destination_feature));"
```

Expected: 10 rows, including `viewpoint` and `waterfall` at the end of the list.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql cloud-sql/schema.sql
git commit -m "DB: add viewpoint and waterfall destination features"
```

---

## Task 2: Update enum documentation

**Files:**
- Modify: `cloud-sql/CLAUDE.md` (Enums section)
- Modify: `web/CLAUDE.md` (Custom enums section)

- [ ] **Step 1: Update `cloud-sql/CLAUDE.md`**

Find the line:

```
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform
```

Replace with:

```
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform, viewpoint, waterfall
```

- [ ] **Step 2: Update `web/CLAUDE.md`**

Find the line (same content as above):

```
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform
```

Replace with:

```
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform, viewpoint, waterfall
```

- [ ] **Step 3: Commit**

```bash
git add cloud-sql/CLAUDE.md web/CLAUDE.md
git commit -m "Docs: viewpoint and waterfall in destination_feature enum"
```

---

## Task 3: Migrate script feature mapping

**Files:**
- Modify: `cloud-sql/migrate/src/migrate-destinations.ts:132-141`

- [ ] **Step 1: Extend the `mapFeatures` mapping**

In `cloud-sql/migrate/src/migrate-destinations.ts`, replace:

```ts
function mapFeatures(arr: string[]): string[] {
  const mapping: Record<string, string> = {
    "volcano": "volcano",
    "fire-lookout": "fire-lookout",
    "summit": "summit",
    "trailhead": "trailhead",
    "landform": "landform",
  };
  return arr.map(f => mapping[f]).filter(Boolean);
}
```

with:

```ts
function mapFeatures(arr: string[]): string[] {
  const mapping: Record<string, string> = {
    "volcano": "volcano",
    "fire-lookout": "fire-lookout",
    "summit": "summit",
    "trailhead": "trailhead",
    "landform": "landform",
    "viewpoint": "viewpoint",
    "waterfall": "waterfall",
  };
  return arr.map(f => mapping[f]).filter(Boolean);
}
```

- [ ] **Step 2: Verify the migrate package still builds**

Run:

```bash
cd cloud-sql/migrate && npm run build
```

Expected: TypeScript compiles with no errors. (If the package has no `build` script, run `npx tsc --noEmit` instead.)

- [ ] **Step 3: Commit**

```bash
git add cloud-sql/migrate/src/migrate-destinations.ts
git commit -m "Migrate: pass through viewpoint and waterfall feature labels"
```

---

## Task 4: OSM auto-import (Overpass query + mapFeature)

**Files:**
- Modify: `web/src/lib/actions/destinations.ts:470-486` (Overpass query)
- Modify: `web/src/lib/actions/destinations.ts:512-526` (`mapFeature` switch)

- [ ] **Step 1: Extend the Overpass query**

In `web/src/lib/actions/destinations.ts`, locate the query block starting at line 470 and replace:

```ts
  const query = `
[out:json][timeout:10];
(
  node["natural"="peak"](around:${radiusM},${lat},${lng});
  node["natural"="volcano"](around:${radiusM},${lat},${lng});
  node["natural"="saddle"](around:${radiusM},${lat},${lng});
  node["tourism"="alpine_hut"](around:${radiusM},${lat},${lng});
  node["tourism"="wilderness_hut"](around:${radiusM},${lat},${lng});
  node["man_made"="tower"]["tower:type"="observation"](around:${radiusM},${lat},${lng});
  node["information"="trailhead"](around:${radiusM},${lat},${lng});
  node["highway"="trailhead"](around:${radiusM},${lat},${lng});
  node["amenity"="shelter"](around:${radiusM},${lat},${lng});
  node["tourism"="camp_site"](around:${radiusM},${lat},${lng});
  node["natural"="water"]["name"](around:${radiusM},${lat},${lng});
  way["natural"="water"]["name"](around:${radiusM},${lat},${lng});
);
out body center;`;
```

with:

```ts
  const query = `
[out:json][timeout:10];
(
  node["natural"="peak"](around:${radiusM},${lat},${lng});
  node["natural"="volcano"](around:${radiusM},${lat},${lng});
  node["natural"="saddle"](around:${radiusM},${lat},${lng});
  node["tourism"="alpine_hut"](around:${radiusM},${lat},${lng});
  node["tourism"="wilderness_hut"](around:${radiusM},${lat},${lng});
  node["man_made"="tower"]["tower:type"="observation"](around:${radiusM},${lat},${lng});
  node["information"="trailhead"](around:${radiusM},${lat},${lng});
  node["highway"="trailhead"](around:${radiusM},${lat},${lng});
  node["amenity"="shelter"](around:${radiusM},${lat},${lng});
  node["tourism"="camp_site"](around:${radiusM},${lat},${lng});
  node["natural"="water"]["name"](around:${radiusM},${lat},${lng});
  way["natural"="water"]["name"](around:${radiusM},${lat},${lng});
  node["tourism"="viewpoint"](around:${radiusM},${lat},${lng});
  node["waterway"="waterfall"](around:${radiusM},${lat},${lng});
  way["waterway"="waterfall"](around:${radiusM},${lat},${lng});
);
out body center;`;
```

- [ ] **Step 2: Extend the `mapFeature` switch**

In the same file, locate the `mapFeature` function (starts around line 512) and replace:

```ts
  function mapFeature(tags: Record<string, string>): { feature: string; label: string } {
    if (tags.natural === "volcano") return { feature: "volcano", label: "volcano" };
    if (tags.natural === "peak") return { feature: "summit", label: "peak" };
    if (tags.natural === "saddle") return { feature: "landform", label: "saddle" };
    if (tags.tourism === "alpine_hut" || tags.tourism === "wilderness_hut")
      return { feature: "hut", label: tags.tourism.replace("_", " ") };
    if (tags["tower:type"] === "observation")
      return { feature: "lookout", label: "observation tower" };
    if (tags.information === "trailhead" || tags.highway === "trailhead")
      return { feature: "trailhead", label: "trailhead" };
    if (tags.amenity === "shelter") return { feature: "hut", label: "shelter" };
    if (tags.tourism === "camp_site") return { feature: "", label: "campsite" };
    if (tags.natural === "water") return { feature: "lake", label: "lake" };
    return { feature: "", label: "poi" };
  }
```

with:

```ts
  function mapFeature(tags: Record<string, string>): { feature: string; label: string } {
    if (tags.natural === "volcano") return { feature: "volcano", label: "volcano" };
    if (tags.natural === "peak") return { feature: "summit", label: "peak" };
    if (tags.natural === "saddle") return { feature: "landform", label: "saddle" };
    if (tags.tourism === "alpine_hut" || tags.tourism === "wilderness_hut")
      return { feature: "hut", label: tags.tourism.replace("_", " ") };
    if (tags["tower:type"] === "observation")
      return { feature: "lookout", label: "observation tower" };
    if (tags.information === "trailhead" || tags.highway === "trailhead")
      return { feature: "trailhead", label: "trailhead" };
    if (tags.amenity === "shelter") return { feature: "hut", label: "shelter" };
    if (tags.tourism === "camp_site") return { feature: "", label: "campsite" };
    if (tags.natural === "water") return { feature: "lake", label: "lake" };
    if (tags.tourism === "viewpoint") return { feature: "viewpoint", label: "viewpoint" };
    if (tags.waterway === "waterfall") return { feature: "waterfall", label: "waterfall" };
    return { feature: "", label: "poi" };
  }
```

- [ ] **Step 3: Verify the web project still builds**

Run:

```bash
cd web && npm run build
```

Expected: Next.js build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/actions/destinations.ts
git commit -m "OSM import: pull viewpoints and waterfalls from Overpass"
```

---

## Task 5: Admin UI dropdowns

**Files:**
- Modify: `web/src/app/admin/destinations/new/page.tsx:50-59`
- Modify: `web/src/app/admin/destinations/[id]/page.tsx:388`
- Modify: `web/src/app/admin/destinations/page.tsx:283-291` and `:349-357`
- Modify: `web/src/app/admin/routes/new/page.tsx:514-520`

- [ ] **Step 1: Update `ALL_FEATURES` in `new/page.tsx`**

In `web/src/app/admin/destinations/new/page.tsx` lines 50-59, replace:

```ts
const ALL_FEATURES = [
  "summit",
  "trailhead",
  "volcano",
  "fire-lookout",
  "hut",
  "lookout",
  "lake",
  "landform",
] as const;
```

with:

```ts
const ALL_FEATURES = [
  "summit",
  "trailhead",
  "volcano",
  "fire-lookout",
  "hut",
  "lookout",
  "lake",
  "landform",
  "viewpoint",
  "waterfall",
] as const;
```

- [ ] **Step 2: Update the feature add dropdown in `[id]/page.tsx`**

In `web/src/app/admin/destinations/[id]/page.tsx` line 388, replace:

```ts
                      {["summit", "trailhead", "volcano", "fire-lookout", "hut", "lookout", "lake", "landform"]
```

with:

```ts
                      {["summit", "trailhead", "volcano", "fire-lookout", "hut", "lookout", "lake", "landform", "viewpoint", "waterfall"]
```

- [ ] **Step 3: Update the table-row feature dropdown in `destinations/page.tsx`**

In `web/src/app/admin/destinations/page.tsx` lines 283-291 (the inline-edit `<select>` inside the table row), find:

```tsx
                              <option value="summit">Summit</option>
                              <option value="trailhead">Trailhead</option>
                              <option value="volcano">Volcano</option>
                              <option value="fire-lookout">Fire Lookout</option>
                              <option value="hut">Hut</option>
                              <option value="lookout">Lookout</option>
                              <option value="lake">Lake</option>
                              <option value="landform">Landform</option>
                            </select>
```

and replace with:

```tsx
                              <option value="summit">Summit</option>
                              <option value="trailhead">Trailhead</option>
                              <option value="volcano">Volcano</option>
                              <option value="fire-lookout">Fire Lookout</option>
                              <option value="hut">Hut</option>
                              <option value="lookout">Lookout</option>
                              <option value="lake">Lake</option>
                              <option value="landform">Landform</option>
                              <option value="viewpoint">Viewpoint</option>
                              <option value="waterfall">Waterfall</option>
                            </select>
```

- [ ] **Step 4: Update the page-level feature filter dropdown in `destinations/page.tsx`**

In the same file, lines 349-357 (the page-level filter), find:

```tsx
            <option value="">All Features</option>
            <option value="summit">Summit</option>
            <option value="trailhead">Trailhead</option>
            <option value="volcano">Volcano</option>
            <option value="fire-lookout">Fire Lookout</option>
            <option value="hut">Hut</option>
            <option value="lookout">Lookout</option>
            <option value="lake">Lake</option>
            <option value="landform">Landform</option>
          </select>
```

and replace with:

```tsx
            <option value="">All Features</option>
            <option value="summit">Summit</option>
            <option value="trailhead">Trailhead</option>
            <option value="volcano">Volcano</option>
            <option value="fire-lookout">Fire Lookout</option>
            <option value="hut">Hut</option>
            <option value="lookout">Lookout</option>
            <option value="lake">Lake</option>
            <option value="landform">Landform</option>
            <option value="viewpoint">Viewpoint</option>
            <option value="waterfall">Waterfall</option>
          </select>
```

- [ ] **Step 5: Update the trailhead feature dropdown in `routes/new/page.tsx`**

In `web/src/app/admin/routes/new/page.tsx` lines 514-520, find:

```tsx
                      <option value="trailhead">Trailhead</option>
                      <option value="summit">Summit</option>
                      <option value="hut">Hut</option>
                      <option value="lookout">Lookout</option>
                      <option value="lake">Lake</option>
                      <option value="landform">Landform</option>
                    </select>
```

and replace with:

```tsx
                      <option value="trailhead">Trailhead</option>
                      <option value="summit">Summit</option>
                      <option value="hut">Hut</option>
                      <option value="lookout">Lookout</option>
                      <option value="lake">Lake</option>
                      <option value="landform">Landform</option>
                      <option value="viewpoint">Viewpoint</option>
                      <option value="waterfall">Waterfall</option>
                    </select>
```

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/destinations/new/page.tsx web/src/app/admin/destinations/[id]/page.tsx web/src/app/admin/destinations/page.tsx web/src/app/admin/routes/new/page.tsx
git commit -m "Admin UI: viewpoint and waterfall feature options"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run web build + lint**

Run:

```bash
cd web && npm run build && npm run lint
```

Expected: build and lint both pass with zero errors. Pre-existing warnings (`<img>` vs `<Image />`) are acceptable per `web/CLAUDE.md`.

- [ ] **Step 2: Run functions build + lint (sanity check)**

Run:

```bash
cd functions && npm run build && npm run lint
```

Expected: build and lint both pass with zero errors. (No functions changes were made; this is a regression sanity check.)

- [ ] **Step 3: Manual smoke test of OSM auto-import**

Pre-condition: web dev server running (`cd web && npm run dev`) with Cloud SQL Auth Proxy active and Task 1's migration applied. Sign in as admin.

1. Navigate to `http://localhost:3000/admin/destinations/new`.
2. In the OSM nearby section, enter coordinates of a known viewpoint and waterfall area. Suggested: **Multnomah Falls, OR** (lat `45.5762`, lng `-122.1158`) — surfaces the falls itself plus several nearby viewpoints along the Columbia River Gorge.
3. Click the "Search OSM" (or equivalent) button.
4. Confirm at least one suggestion comes back with `feature` value `viewpoint` and at least one with `feature` value `waterfall`. Inspect the suggestion list in the rendered UI.
5. Accept one viewpoint and one waterfall suggestion to create them.
6. Verify the created destinations appear at `/admin/destinations` with the correct feature badge and that the table-row and page-level filters can filter to each new feature value.

If any suggestion comes back with empty `feature` despite having `tourism=viewpoint` or `waterway=waterfall` tags, the `mapFeature` switch is mis-ordered or the Overpass query is malformed — re-check Task 4.

- [ ] **Step 4: Push to deploy**

If everything is green:

```bash
git push origin main
```

Then per `CLAUDE.md`: monitor the workflow with `gh run list --limit 1` and `gh run watch <id>`. The `deploy-functions` and `deploy-api` jobs both must pass before considering the work complete. The migration SQL is not auto-applied by deploy — apply it against the production database via the same `psql` flow as Task 1 step 3 (or whatever your standard prod migration apply step is).
