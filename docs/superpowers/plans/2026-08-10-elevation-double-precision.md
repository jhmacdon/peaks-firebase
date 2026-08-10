# Elevation Double Precision Implementation Plan

> **For agentic workers:** Implement each task test-first. Keep Firebase and iOS commits separate and review each diff before integration.

**Goal:** Preserve trusted fractional-meter elevation values through Peaks storage, APIs, profiles, imports, calculations, and exports, then repair every live value recoverable from an existing trusted source.

**Architecture:** PostgreSQL `float8`, TypeScript `number`, and Swift `Double` remain the canonical types. The existing base64/pipe route-profile wire format gains decimal tokens without breaking released clients. A transactional migration rebuilds Peaks-owned profiles from PostGIS Z values and adds equality checks for denormalized point elevations. Display rounding and low-error render caches stay outside the canonical data path.

**Tech stack:** PostgreSQL 15/PostGIS, Node 20/TypeScript, Next.js 16, Swift 5/iOS, Node test runner, XCTest.

---

### Task 1: PostgreSQL profile contract and repair migration

**Files:**

- Modify: `cloud-sql/schema.sql`
- Create: `cloud-sql/migrations/20260810_elevation_double_precision.sql`
- Modify: `cloud-sql/migrate/src/__tests__/route-elevation-profile.test.ts`
- Modify: `cloud-sql/migrate/src/__tests__/route-elevation-jobs.integration.test.ts`

Steps:

1. Add failing tests proving `encode_route_elevation_profile` keeps `1234.567890123`, rejects non-finite Z values, preserves vertex count, and no longer calls `round`.
2. Add failing migration tests proving the migration rebuilds only Peaks-owned profiles backed by valid `LineStringZ` paths, changes no path bytes, and is idempotent.
3. Change the SQL encoder and real-range test to use finite double values directly.
4. Add equality checks for non-null `destinations.elevation`/location Z and `tracking_points.elevation`/location Z after an explicit preflight mismatch guard.
5. Rebuild valid Peaks-owned profiles in the migration and add post-update assertions that decoded tokens match each path vertex.
6. Run the focused unit and guarded integration tests.

### Task 2: TypeScript profile and terrain precision

**Files:**

- Modify: `cloud-sql/migrate/src/route-elevation-profile.ts`
- Modify: `cloud-sql/migrate/src/__tests__/route-elevation-profile.test.ts`
- Modify: `cloud-sql/migrate/src/lib/terrarium-elevation.ts`
- Modify: `cloud-sql/migrate/src/__tests__/terrarium-elevation.test.ts`
- Modify: `cloud-sql/migrate/src/backfill-elevations.ts`
- Modify: `cloud-sql/migrate/src/import-14er-routes.ts`
- Modify affected importer tests under `cloud-sql/migrate/src/__tests__/`

Steps:

1. Add a failing round-trip test using `[1234.567890123, -0.125, 0, 4321.0000001]` plus malformed and non-finite tokens.
2. Update the encoder to use round-trippable decimal text and the decoder to accept finite decimal/scientific tokens while retaining integer compatibility and vertex-count checks.
3. Add a Terrarium RGB fixture whose decoded value has a 1/256-meter fraction and prove the decoder keeps it.
4. Remove final decimal-place rounding from stored elevation samples and gain/loss calculations. Keep rounding in log text only.
5. Run the full migrate unit suite.

### Task 3: Web destination, route, session, and GPX writers

**Files:**

- Modify: `web/src/lib/actions/destinations.ts`
- Modify: `web/src/app/admin/destinations/new/page.tsx`
- Modify: `web/src/lib/actions/route-builder.ts`
- Modify: `web/src/lib/actions/route-import.ts`
- Modify: `web/src/lib/actions/routes.ts`
- Modify: `web/src/lib/actions/segment-matcher.ts`
- Modify: `web/src/lib/elevation.ts`
- Modify: `web/src/lib/session-import.ts`
- Modify: `web/src/lib/session-track.ts`
- Modify: `web/local-seed-pg.mjs`
- Modify: `web/CLAUDE.md`
- Add or modify focused tests beside these modules.

Steps:

1. Add failing tests that pass `1234.567890123` through destination creation, automatic trailheads, elevation lookup, route analysis, session gain, and GPX export/import.
2. Remove storage-time `Math.round`, tenth-meter rounding, and `toFixed(2)` from canonical values.
3. Keep UI-only whole-foot and whole-meter formatting unchanged.
4. Replace elevation/prominence truthiness readers with explicit null checks so zero remains zero.
5. Change the web rule from “round before inserting” to the precision contract.
6. Run focused tests, then web build and lint.

### Task 4: API input validation and denormalized-value consistency

**Files:**

- Modify: `cloud-sql/api/src/routes/plans.ts`
- Modify: `cloud-sql/api/src/routes/sessions.ts`
- Modify or create a focused numeric validation helper under `cloud-sql/api/src/lib/`
- Modify API tests under `cloud-sql/api/src/__tests__/`

Steps:

1. Add failing tests for fractional, zero, null, NaN, and infinite elevation/gain/high-point inputs.
2. Validate every client-supplied elevation-like scalar and GeoJSON Z value as finite before SQL.
3. Replace truthiness defaults with nullish handling so zero does not become null.
4. Send the same validated value to each plain column and PostGIS Z expression.
5. Run the complete API unit suite and guarded database suite.

### Task 5: Recoverable-data audit tool

**Files:**

- Create: `cloud-sql/migrate/src/audit-elevation-precision.ts`
- Create: `cloud-sql/migrate/src/__tests__/audit-elevation-precision.test.ts`
- Modify: `cloud-sql/migrate/package.json`

Steps:

1. Add failing tests for a read-only report that counts schema types, plain/Z mismatches, integer-looking destination values, legacy integer route profiles, recoverable Peaks profiles, and rows with source IDs that require review.
2. Implement JSON and human output without user/session identifiers.
3. Mark locally recoverable rows separately from rows that need a checked external source; never invent a decimal value.
4. Add the package script and run it against fixtures/test DB.

### Task 6: Swift route profile and numeric parsing

**Files (iOS repo):**

- Modify: `peakscore/Routes/RouteAnalysis.swift`
- Modify: `peakscore/Routes/RouteRepo.swift`
- Modify: `peakscore/Repositories/DestinationRepo.swift`
- Modify: `PeaksAppTests/RouteAnalysisTests.swift`
- Modify or add focused API parsing tests.

Steps:

1. Add a failing Swift route-profile round-trip test with `1234.567890123` and legacy integer input.
2. Encode finite `Double` tokens without narrowing to `Int`; reject non-finite samples.
3. Use tolerant numeric parsing for destination elevation/prominence and route gain/loss/distance.
4. Run focused XCTest cases with the outbound API audit enabled.

### Task 7: Swift viewfinder, plan weather, and GPX boundaries

**Files (iOS repo):**

- Modify: `peakscore/Repositories/PeaksAPI.swift`
- Modify: `peakscore/NewUI/Sheets/PlanDetail/PlanDossierModels.swift`
- Modify: `peakscore/NewUI/Sheets/PlanDetail/PlanOutlookBand.swift`
- Modify: `peakscore/NewUI/Sheets/PlanDetail/PlanSummitWeather.swift`
- Modify: `peakscore/NewUI/Sheets/PlanDetailView.swift`
- Modify: `peakscore/NewUI/Sheets/DestinationDetailView.swift`
- Modify: `peakscore/Export/GPXExporter.swift`
- Modify: `PeaksAppTests/PeakViewfinderContextTests.swift`
- Modify: `PeaksAppTests/PlanSummitWeatherTests.swift`
- Modify: `PeaksAppTests/GPXExporterTests.swift`

Steps:

1. Add failing tests showing fractional eye elevation, summit anchor, weather cache key/query, and GPX elevation survive.
2. Carry `Double` through viewfinder and plan-weather domain state; format a decimal only at the URL boundary.
3. Export enough decimal digits for a `Double` text round trip.
4. Keep visible elevation labels rounded as before.
5. Run the focused tests and build the iPhone 17 Pro simulator target with `ENABLE_USER_SCRIPT_SANDBOXING=NO`.

### Task 8: Cross-system verification and live repair evidence

Steps:

1. Run Firebase migrate, API, and web suites; build and lint all changed packages.
2. Run focused iOS tests with `TEST_RUNNER_PEAKS_AUDIT_API=1`, confirm no outbound audit file, and build `PeaksApp`.
3. Run the new elevation audit read-only against live Cloud SQL and save counts in the handoff.
4. Apply the tested SQL migration only after its live preflight reports zero unrecoverable plain/Z mismatches; re-run it to prove idempotence.
5. Verify every rebuilt Peaks profile matches the PostGIS path, geometry hashes are unchanged, and old integer profiles remain decodable.
6. Review both diffs for unrelated files, commit each repo separately, and report any rows that still need a trusted outside source.
