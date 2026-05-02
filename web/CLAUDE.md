# Peaks Web

Public-facing web app + admin dashboard for Peaks, a peak-bagging tracker. See **`ARCHITECTURE.md`** for detailed architecture decisions, data flow, and system design. Keep it updated when adding features or changing patterns.

## Stack

- **Framework**: Next.js 16 (App Router, server actions)
- **React**: 19, TypeScript 5
- **Styling**: Tailwind CSS v4 (dark mode via OS `prefers-color-scheme`)
- **Database**: PostgreSQL 15+ with PostGIS + pg_trgm (via `pg` pool in `src/lib/db.ts`)
- **Firestore**: User profiles, trip plans, trip reports, friends (via Firebase Admin SDK)
- **Auth**: Firebase Auth (email/password, Google, Apple); `admin` claim for admin pages
- **Maps**: Leaflet + react-leaflet (OpenTopoMap tiles)
- **Geocoding/Elevation**: Mapbox API (reverse geocode, Terrain-RGB tiles)
- **Storage**: Firebase Storage (avatar uploads)

## Dev

```bash
cd /Users/josiahm/projects/peaks/firebase/web
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint         # eslint
```

Requires Cloud SQL Auth Proxy running locally for database access (`DB_HOST=127.0.0.1:5432`).

**Always run `npm run build && npm run lint` after making changes.** Both must pass with zero errors before considering work complete.

## Project Structure

```
src/
  app/
    layout.tsx                        # Root layout (fonts, metadata)
    page.tsx                          # Redirects to /discover
    login/page.tsx                    # Sign in (email, Google, Apple)
    register/page.tsx                 # Create account
    not-found.tsx                     # 404 page
    (public)/                         # Route group: public pages (AppNav, no auth)
      layout.tsx
      discover/page.tsx               # Search + nearby + popular + lists
      destinations/[id]/page.tsx      # Destination detail (read-only)
      destinations/[id]/reports/      # Trip reports for destination
      routes/[id]/page.tsx            # Route detail
      lists/page.tsx                  # Browse all lists
      lists/[id]/page.tsx             # List detail + progress
      map/page.tsx                    # Full-screen map explorer
      reports/[id]/page.tsx           # Trip report detail
    (authenticated)/                  # Route group: auth-required (AppNav + UserAuthGuard)
      layout.tsx
      log/page.tsx                    # Session log + lifetime stats
      log/[id]/page.tsx               # Session detail with GPS track
      plans/page.tsx                  # Trip plans list
      plans/new/page.tsx              # Create plan
      plans/[id]/page.tsx             # Plan detail
      reports/new/page.tsx            # Write trip report
      account/page.tsx                # Account overview
      account/profile/page.tsx        # Edit name + avatar
      account/friends/page.tsx        # Friends + invites
    admin/                            # Admin dashboard (AdminGuard, admin claim)
      layout.tsx
      page.tsx                        # Dashboard
      login/page.tsx                  # Admin sign in
      destinations/                   # Destination management
      routes/                         # Route management + builder
  components/
    # Navigation
    app-nav.tsx                       # User nav (top on desktop, bottom tabs on mobile)
    admin-nav.tsx                     # Admin top nav bar
    # Auth guards
    user-auth-guard.tsx               # Checks user != null, redirects to /login
    admin-guard.tsx                   # Checks admin claim, redirects to /admin/login
    # Maps (all use dynamic import, ssr: false)
    destination-map.tsx               # Single marker
    route-map.tsx                     # Polyline6 route
    session-map.tsx                   # GPS breadcrumbs, color-coded segments
    explore-map.tsx                   # Full-screen, viewport loading, layer toggle
    route-builder-map.tsx             # Interactive segment overlays (admin)
    location-picker-map.tsx           # Draggable marker (admin)
    # Data display
    destination-card.tsx              # Destination preview card
    session-card.tsx                  # Session preview (derives name from destinations)
    plan-card.tsx                     # Plan preview card
    trip-report-card.tsx              # Report preview card
    friend-card.tsx                   # Friend profile card
    stats-banner.tsx                  # Horizontal stat cards grid
    progress-bar.tsx                  # Completion fraction bar
    elevation-profile.tsx             # Canvas elevation chart
    avatar.tsx                        # User avatar with initials fallback
    # Interactive
    search-bar.tsx                    # Debounced input, URL-synced
    block-editor.tsx                  # Text/photo block editor for reports
    destination-picker.tsx            # Search-and-select destinations
    route-picker.tsx                  # Search-and-select routes
    party-list.tsx                    # Party member display
    user-popover.tsx                  # User info popover (admin)
  lib/
    db.ts                             # pg Pool (max 5 connections)
    firebase.ts                       # Client SDK init (auth, firestore)
    firebase-admin.ts                 # Admin SDK init (adminAuth, adminDb)
    auth-context.tsx                  # useAuth() hook + AuthProvider
    auth-actions.ts                   # verifyToken() server action
    storage.ts                        # Firebase Storage upload/download
    gpx.ts                            # GPX parser
    elevation.ts                      # Mapbox Terrain-RGB elevation lookup
    route-utils.ts                    # Polyline encoding, WKT, ID generation
    search-utils.ts                   # Geographic abbreviation normalization
    actions/
      search.ts                       # Trigram search, nearby, popular, viewport (PostgreSQL)
      destinations.ts                 # Destination CRUD, geocoding, import (PostgreSQL)
      routes.ts                       # Route CRUD, segments, elevation (PostgreSQL)
      lists.ts                        # List browse, detail, progress (PostgreSQL)
      sessions.ts                     # User sessions, GPS points, stats (PostgreSQL)
      plans.ts                        # Trip plan CRUD, party (Firestore)
      trip-reports.ts                 # Trip report CRUD (Firestore)
      profile.ts                      # User profile, friends, invites (Firestore)
      users.ts                        # Firebase Auth user lookup
      route-builder.ts                # GPX → route analysis pipeline (admin)
      segment-matcher.ts              # Route decomposition (admin)
```

## Database

PostgreSQL with PostGIS. Schema at `../cloud-sql/schema.sql`.

### Custom enums
- `destination_type`: point, region
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform, viewpoint, waterfall
- `activity_type`: outdoor-trek, outdoor-moto, ski
- `completion_mode`: none, straight, reverse
- `route_shape`: out_and_back, loop, point_to_point, lollipop

### Key tables
- `destinations` — peaks, trailheads, POIs (PointZ geography, features array, activities array)
- `routes` — composed from segments, materialized path/stats
- `segments` — atomic trail sections, one-way geometry
- `route_segments` — ordered join with direction (forward/reverse)
- `route_destinations` — ordered join (ordinal = position along route)
- `lists` / `list_destinations` — curated destination collections
- `tracking_sessions` / `tracking_points` — user activity recordings

### Query patterns
- Always use parameterized queries: `db.query(sql, [params])`
- PostGIS geography (spherical, meters): `ST_DWithin`, `ST_MakePoint`, `ST_GeomFromText`
- Array enum casting: `$1::destination_feature[]`, `$1::activity_type[]`
- Trigram search: `search_name % $1` with `similarity()` ranking
- Transactions: acquire client from pool, `BEGIN`/`COMMIT`/`ROLLBACK`

## Server Actions

All files in `src/lib/actions/` use `"use server"` directive.

- Every exported function must be `async` (Next.js requirement)
- Sync utility functions must live in separate files (e.g. `route-utils.ts`, `gpx.ts`)
- Large uploads: `serverActions.bodySizeLimit` set to `"20mb"` in `next.config.ts`

## Auth Flow

**User auth** (public app):
1. User signs in at `/login` (email/password, Google, or Apple)
2. `AuthProvider` sets `user` and `isAdmin` from Firebase `onAuthStateChanged`
3. `UserAuthGuard` wraps `(authenticated)` pages — redirects to `/login` if not signed in
4. Server actions receive ID token from client, verified via `verifyToken()` → `adminAuth.verifyIdToken()`

**Admin auth**:
1. Admin signs in at `/admin/login` with email/password
2. `AdminGuard` checks `claims.admin === true` — redirects to `/admin/login` if not admin

## Conventions

- **Components**: kebab-case filenames, `"use client"` for interactive components
- **Dynamic imports**: Leaflet maps use `next/dynamic` with `ssr: false`
- **Import alias**: `@/` → `src/`
- **IDs**: `generateId()` produces 20-char alphanumeric strings (matches Firebase style)
- **Units**: database stores meters; UI converts to feet (`* 3.28084`) and miles (`/ 1609.34`)
- **Elevation**: always `Math.round()` before inserting; use `::double precision` cast in COALESCE
- **Features row**: always shows Features in detail pages (displays "—" when empty, not hidden)
- **Geocoding**: Mapbox v6 API for reverse geocoding (country/state codes, place names)
- **Session names**: derived from destinations reached (sorted by elevation), not explicit `name` field. See `ARCHITECTURE.md` for details.
- **Route groups**: `(public)` and `(authenticated)` are filesystem-only — they don't create URL segments. Never use `/app/` prefix in links.
- **Activity types**: exist in schema but not exposed in the web UI yet
