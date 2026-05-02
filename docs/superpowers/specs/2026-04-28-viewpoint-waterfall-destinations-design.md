# Viewpoint and Waterfall Destination Features

**Date:** 2026-04-28
**Status:** Approved

## Goal

Add `viewpoint` and `waterfall` as two new first-class values of the `destination_feature` enum, following the same pattern established by the recent `landform` feature (commit `1b83a99`).

## Rationale

Viewpoints and waterfalls are common destination types for hikers and backpackers that the current schema cannot represent. They are conceptually distinct (a viewpoint is a vista; a waterfall is a hydrological feature) and users will likely want to filter on each independently, so they each get their own enum value rather than being grouped under a broader umbrella.

## Scope

### In scope

- New enum values: `viewpoint` and `waterfall`
- Database migration adding both values
- OSM auto-import support via the existing Overpass query in `searchOSMNearby`
- Admin UI options in all four feature dropdowns
- Migrate script passthrough mappings

### Out of scope

- Icons or custom visual treatment in the admin UI (current admin renders feature name as text)
- Public-facing UI changes beyond what existing generic feature handling already covers
- Extra schema columns for feature-specific attributes (waterfall height, viewpoint direction)
- Backfilling existing destinations with the new features

## Changes

### 1. Database migration

New file: `cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql`

```sql
-- Add viewpoint and waterfall destination features for vistas and hydrological points of interest.
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'viewpoint';
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'waterfall';
```

### 2. Schema and docs

Update the enum definition and documentation in three places to keep them in sync:

- `cloud-sql/schema.sql` — add `'viewpoint', 'waterfall'` to the `destination_feature` enum
- `cloud-sql/CLAUDE.md` — update the `destination_feature` line in the Enums section
- `web/CLAUDE.md` — update the `destination_feature` line in the Custom enums section

### 3. OSM auto-import

In `web/src/lib/actions/destinations.ts`, extend the `searchOSMNearby` function:

**Overpass query** — add three new selectors:

```
node["tourism"="viewpoint"](around:${radiusM},${lat},${lng});
node["waterway"="waterfall"](around:${radiusM},${lat},${lng});
way["waterway"="waterfall"](around:${radiusM},${lat},${lng});
```

**`mapFeature` switch** — add two new cases:

```ts
if (tags.tourism === "viewpoint") return { feature: "viewpoint", label: "viewpoint" };
if (tags.waterway === "waterfall") return { feature: "waterfall", label: "waterfall" };
```

OSM tag rationale:
- `tourism=viewpoint` is the canonical OSM tag for viewpoints (~400k entries globally).
- `waterway=waterfall` is the canonical OSM tag for waterfalls (~80k entries). The deprecated `natural=waterfall` variant is intentionally excluded — including it yields mostly duplicates.

### 4. Migrate script

In `cloud-sql/migrate/src/migrate-destinations.ts`, add two entries to the `mapping` object inside `mapFeatures()`:

```ts
"viewpoint": "viewpoint",
"waterfall": "waterfall",
```

This ensures any legacy Firestore records that already use these labels survive a re-run of the Firestore → PostGIS migration.

### 5. Admin UI dropdowns

Add `viewpoint` and `waterfall` options (matching the existing capitalization style — `<option value="viewpoint">Viewpoint</option>`) to:

- `web/src/app/admin/destinations/[id]/page.tsx` — feature add dropdown
- `web/src/app/admin/destinations/new/page.tsx` — `ALL_FEATURES` constant
- `web/src/app/admin/destinations/page.tsx` — both filter dropdowns (table row select + page-level filter)
- `web/src/app/admin/routes/new/page.tsx` — feature dropdown

## Verification

- Apply the migration against the local database via the Cloud SQL Auth Proxy: `psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -f cloud-sql/migrations/20260428_destination_viewpoint_waterfall.sql`
- Confirm the enum values were added: `psql ... -c "SELECT unnest(enum_range(NULL::destination_feature));"`
- `cd web && npm run build && npm run lint` — both must pass with zero errors
- `cd functions && npm run build && npm run lint` — sanity check (no functions changes expected, but verify nothing breaks)
- Manually exercise the OSM import in the admin "new destination" flow at coordinates known to have a viewpoint and a waterfall nearby; confirm both surface as suggestions with the correct `feature` value.

## Risks

- **Enum value ordering** — Postgres `ALTER TYPE ADD VALUE` appends to the enum. Any code that depends on enum ordinal position would break, but no such code exists in this repo (all use is by string value).
- **OSM coverage** — `tourism=viewpoint` includes a wide range of vistas (some quite minor); auto-import may surface lower-quality suggestions. Acceptable: the admin still curates which suggestions get accepted.
