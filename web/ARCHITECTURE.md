# Peaks Web — Architecture

## Overview

The Peaks web app serves two audiences from a single Next.js 16 deployment:

1. **Public-facing app** — search, browse, and view destinations, protected areas, routes, lists, trip reports, shared activity playback, and a full-screen map. Authenticated users can also edit sessions, save destinations, create trip plans, write and edit trip reports, and manage their account/friends.
2. **Admin dashboard** — internal tool for managing destination/route data, GPX imports, and segment analysis. Requires Firebase `admin` custom claim.

## URL Structure

```
/                         → landing page (public)
/discover                 → search + nearby + popular + lists (public)
/destinations/[id]        → destination detail (public)
/destinations/[id]/reports → trip reports for destination (public)
/areas/[id]               → protected-area detail, boundary, destinations, routes (public)
/routes/[id]              → route detail (public)
/lists                    → browse all lists (public)
/lists/[id]               → list detail + progress (public)
/map                      → full-screen map explorer (public)
/reports/[id]             → trip report detail (public)
/login                    → sign in (email/password, Google, Apple)
/register                 → create account

/log                      → session log + lifetime stats (auth required)
/log/[id]                 → public playback for shared sessions; owner edit/export when signed in
/log/import               → GPX activity import + matching (auth required)
/saved                    → saved destinations (auth required)
/plans                    → trip plans list (auth required)
/plans/new                → create plan (auth required)
/plans/[id]               → plan detail (auth required)
/reports/new              → write trip report (auth required)
/reports/[id]/edit        → edit or delete an owned trip report (auth required)
/account                  → account overview (auth required)
/account/profile          → edit name + avatar (auth required)
/account/friends          → friends list + invites (auth required)

/admin/                   → admin dashboard (admin claim required)
/admin/login              → admin sign in
/admin/destinations/      → destination management
/admin/routes/            → route management + builder
```

## Route Groups

Next.js route groups (parenthesized directory names) organize layouts without affecting URLs:

- **`(public)/`** — wraps public pages with `AppNav`. No auth required. Layout provides `AuthProvider` so components can optionally check sign-in state (e.g., list progress bars).
- **`(authenticated)/`** — wraps auth-required pages with `AppNav` + `UserAuthGuard`. Redirects to `/login` if not signed in. Does NOT require admin claim — any Firebase user can access.
- **`admin/`** — separate layout with `AdminNav` + `AdminGuard`. Requires `claims.admin === true`.

## Data Layer

### Two databases, one app

| Store | Used for | Access pattern |
|-------|----------|----------------|
| **PostgreSQL** (PostGIS) | Destinations, protected areas, routes, segments, lists, sessions, tracking points | Server actions via `pg` pool (`src/lib/db.ts`) |
| **Firestore** | User profiles, saved destinations, trip plans, trip reports, friends, invites | Server actions via Firebase Admin SDK (`src/lib/firebase-admin.ts`) |

The split follows the data's nature: spatial/relational data lives in PostGIS for efficient geo queries; user-owned social data lives in Firestore for simple document reads and real-time rules.

### Server actions

All data access goes through Next.js server actions in `src/lib/actions/`. Every file uses `"use server"`.

| File | Database | Purpose |
|------|----------|---------|
| `destinations.ts` | PostgreSQL | CRUD, search, geocoding, bulk import |
| `areas.ts` | PostgreSQL | Public area detail and token-scoped personal activity |
| `routes.ts` | PostgreSQL | CRUD, segments, elevation profiles |
| `search.ts` | PostgreSQL | Destination and area search, nearby, popular, viewport queries |
| `lists.ts` | PostgreSQL | List browse, detail, progress tracking |
| `sessions.ts` | PostgreSQL | User sessions, GPS points, stats, metadata edits, export, deletion |
| `public-sessions.ts` | PostgreSQL | Anonymous read-only bundle for public session playback |
| `session-import.ts` | Cloud Run API | Token-forwarded GPX session create, chunked points, final processing |
| `saved-destinations.ts` | Firestore + PostgreSQL | iOS-compatible saved-item documents and catalog resolution |
| `plans.ts` | Firestore | Trip plan CRUD, party management |
| `trip-reports.ts` | Firestore | Owner-checked trip report CRUD |
| `profile.ts` | Firestore | User profile, friends, invites |
| `users.ts` | Both | Firebase Auth user lookup |
| `route-builder.ts` | PostgreSQL | GPX → route analysis pipeline (admin) |
| `route-import.ts` | PostgreSQL | Validated pending-route imports with source provenance |
| `segment-matcher.ts` | PostgreSQL | Route decomposition (admin) |

### Auth for server actions

Public actions (search, get destination, get list) take no token.

User-scoped actions accept a Firebase ID token as the first parameter:
1. Client calls `getIdToken()` from `useAuth()` hook
2. Server action calls `verifyToken(token)` from `src/lib/auth-actions.ts`
3. `verifyToken` uses `adminAuth.verifyIdToken()` to decode the JWT and extract `uid`
4. The `uid` scopes all subsequent queries (e.g., `WHERE user_id = $1`)

Admin actions accept a Firebase ID token as the first parameter and verify it
server-side with `verifyAdminToken(token)` (`src/lib/auth-actions.ts`), which
requires the `admin` custom claim. `AdminGuard` remains the client-side gate.
Some admin write paths (destination create, bulk import, boundary edits, route
import) still have no server-side check and rely on `AdminGuard` alone.

## Auth Architecture

```
                    ┌─────────────────┐
                    │  Firebase Auth   │
                    │  (hosted by Google) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        Email/Password    Google        Apple
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │  AuthProvider    │
                    │  (client context)│
                    │  - user          │
                    │  - isAdmin       │
                    │  - getIdToken()  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        AdminGuard    UserAuthGuard    (no guard)
        admin claim     user != null    public pages
        → /admin/*      → /log, etc.   → /discover, etc.
```

`AuthProvider` wraps both `(public)` and `(authenticated)` route groups. Public pages can optionally read `user` to show signed-in features (e.g., list progress). Auth-required pages are wrapped in `UserAuthGuard` which redirects to `/login`.

On account creation, a Firestore document is created at `users/{uid}` with name/email.

## Search Architecture

Destination and protected-area search use PostgreSQL `pg_trgm` indexes. Destination results use composite scoring:

```
Score = text_similarity × 0.55
      + prefix_bonus    × 0.15    (name starts with query)
      + proximity       × 0.15    (EXP(-distance/500km))
      + elevation       × 0.10    (normalized to 0-1)
      + prominence      × 0.05    (normalized to 0-1)
```

When no lat/lng is available, proximity weight redistributes to elevation (0.15) and prominence (0.10). Area results combine trigram similarity with a prefix bonus and catalog counts. Browser geolocation is requested on the discover page to enable geo-biased destination results.

The map explorer uses viewport-based queries (`ST_Intersects` with `ST_MakeEnvelope`) backed by GIST spatial indexes, debounced at 300ms on pan/zoom.

## Session Display Names

Sessions in the database often have `name = NULL`. The display name is derived:
1. Explicit `name` if set
2. Comma-separated destination names from `session_destinations`, sorted by elevation (highest first)
3. Fallback: "Untitled Session"

The `getUserSessions` action batch-fetches destination names for all sessions in one query to avoid N+1.

Session detail keeps the map, timeline, elevation cursor, and heart rate in sync. Playback compresses the full recording to about 45 seconds at 1×, with 0.5×, 2×, and 4× controls. Owner actions can change the name, activity type, and visibility; export uses the full point set rather than the display downsample. Deletion writes a sync tombstone in the same database transaction.

Protected-area chips come from `session_areas`, which stores exact intersections between each saved GPS track segment and indexed subdivisions of each official area boundary. Session processing refreshes these links with the rest of the session data, and PAD-US updates refresh old links in small batches. `cloud-sql/api/scripts/backfill-session-areas.ts` fills the table for older recordings after the matching migration runs.

GPX import parses and previews the file in the browser, then repeats validation in a server action. The server action creates an unfinished session, uploads points in 2,000-point chunks, and marks the session ended only after every chunk succeeds. That final write starts destination and route matching once, against the complete track. Imports use the existing Cloud Run API and add no service.

## Component Architecture

### Navigation
- **`AppNav`** — responsive: top bar on desktop (`hidden md:block`), fixed bottom tabs on mobile (`md:hidden`). Shared across public and auth pages.
- **`AdminNav`** — desktop-only top bar for admin pages.

### Map components
All map components use `react-leaflet` with `next/dynamic` + `ssr: false` (Leaflet requires `window`).

| Component | Purpose |
|-----------|---------|
| `destination-map` | Single marker (destination detail) |
| `area-map` | Protected-area boundary, destination markers, and route lines |
| `route-map` | Polyline6-encoded route |
| `session-map` | GPS breadcrumbs, segment colors, completed path, playback cursor |
| `explore-map` | Full-screen with viewport loading, topo/satellite toggle |
| `route-builder-map` | Interactive segment overlays (admin) |
| `location-picker-map` | Draggable marker (admin) |

### Reusable components

| Component | Used by |
|-----------|---------|
| `destination-card` | Discover, list detail, search results |
| `area-card` | Protected-area search results |
| `save-destination-button` | Destination detail |
| `session-card` | Session log, protected-area activity |
| `session-playback` | Session map, scrubber, elevation, speed, heart rate |
| `session-actions` | Session edit, share, GPX export, delete |
| `plan-card` | Plans list |
| `trip-report-card` | Report listings |
| `search-bar` | Discover, lists (URL-synced, debounced) |
| `progress-bar` | List detail (completion fraction) |
| `stats-banner` | Session log (lifetime stats) |
| `elevation-profile` | Route detail, session detail |
| `block-editor` | Trip report creation and editing |
| `destination-picker` | Plan creation, report creation and editing |
| `route-picker` | Plan creation |
| `avatar` | Account, friends, party list |
| `friend-card` | Friends page |
| `party-list` | Plan detail |

## Key Design Decisions

### Why two databases?
PostGIS is essential for spatial queries (nearby, viewport, distance calculations). Firestore is already the source of truth for user-owned data in the iOS app and provides real-time sync + simple security rules. Migrating everything to one store would sacrifice either spatial capabilities or iOS compatibility.

### Why server actions instead of API routes?
Server actions are the browser-facing boundary. They're typed end-to-end, colocated with the code that calls them, and handle serialization automatically. Most read actions query Postgres or Firestore directly. Activity import and deletion forward the signed-in token to the Cloud Run Express API so session processing, tombstones, and destination-average updates stay in one write path shared with iOS.

### Why keep route provenance on the route?
Route geometry can come from public trail data or OpenStreetMap. The `routes.provenance` JSONB object keeps the source, license, attribution, retrieval time, and contributing OSM ways with the geometry. The public route map shows that information beside the route so attribution stays with the data it describes.

### Why client-side rendering for most pages?
Most pages use `"use client"` because they need interactive state (auth context, search input, map interactions). Data is fetched in `useEffect` via server actions. This keeps the architecture simple — no RSC/client boundary complexity.

### Saved destination compatibility
Saved destinations stay in `users/{uid}/savedDestinations/{destinationId}` so iOS and web use one source. A live document requires `savedAt`; only `deleted === true` is a tombstone. The web writes full documents for both save and unsave and warns when an ID has not reached the PostgreSQL destination catalog.

### Trip report compatibility
The web reads both its `blocks` representation and the iOS `content` plus `headerPhotos` representation. Web creates and edits write both forms, preserve iOS photo IDs and dates, and store the trip date as a Firestore `Timestamp`. Firestore rules require the signed-in owner for report writes and saved-destination reads or writes.

### Session naming strategy
The iOS app rarely sets explicit session names. Instead, sessions are identified by their destinations — "Mount Rainier, Camp Muir" is more meaningful than a timestamp. The web app derives names from `session_destinations` sorted by elevation, matching the Strava upload naming pattern in the Cloud Functions.
