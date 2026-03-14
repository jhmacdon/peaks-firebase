# Peaks Web — Architecture

## Overview

The Peaks web app serves two audiences from a single Next.js 16 deployment:

1. **Public-facing app** — search, browse, and view destinations, routes, lists, trip reports, and a full-screen map. Authenticated users can also view their session log, create trip plans, write trip reports, and manage their account/friends.
2. **Admin dashboard** — internal tool for managing destination/route data, GPX imports, and segment analysis. Requires Firebase `admin` custom claim.

## URL Structure

```
/                         → redirects to /discover
/discover                 → search + nearby + popular + lists (public)
/destinations/[id]        → destination detail (public)
/destinations/[id]/reports → trip reports for destination (public)
/routes/[id]              → route detail (public)
/lists                    → browse all lists (public)
/lists/[id]               → list detail + progress (public)
/map                      → full-screen map explorer (public)
/reports/[id]             → trip report detail (public)
/login                    → sign in (email/password, Google, Apple)
/register                 → create account

/log                      → session log + lifetime stats (auth required)
/log/[id]                 → session detail with GPS track (auth required)
/plans                    → trip plans list (auth required)
/plans/new                → create plan (auth required)
/plans/[id]               → plan detail (auth required)
/reports/new              → write trip report (auth required)
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
| **PostgreSQL** (PostGIS) | Destinations, routes, segments, lists, sessions, tracking points | Server actions via `pg` pool (`src/lib/db.ts`) |
| **Firestore** | User profiles, trip plans, trip reports, friends, invites | Server actions via Firebase Admin SDK (`src/lib/firebase-admin.ts`) |

The split follows the data's nature: spatial/relational data lives in PostGIS for efficient geo queries; user-owned social data lives in Firestore for simple document reads and real-time rules.

### Server actions

All data access goes through Next.js server actions in `src/lib/actions/`. Every file uses `"use server"`.

| File | Database | Purpose |
|------|----------|---------|
| `destinations.ts` | PostgreSQL | CRUD, search, geocoding, bulk import |
| `routes.ts` | PostgreSQL | CRUD, segments, elevation profiles |
| `search.ts` | PostgreSQL | Trigram search, nearby, popular, viewport queries |
| `lists.ts` | PostgreSQL | List browse, detail, progress tracking |
| `sessions.ts` | PostgreSQL | User sessions, GPS points, stats |
| `plans.ts` | Firestore | Trip plan CRUD, party management |
| `trip-reports.ts` | Firestore | Trip report CRUD |
| `profile.ts` | Firestore | User profile, friends, invites |
| `users.ts` | Both | Firebase Auth user lookup |
| `route-builder.ts` | PostgreSQL | GPX → route analysis pipeline (admin) |
| `segment-matcher.ts` | PostgreSQL | Route decomposition (admin) |

### Auth for server actions

Public actions (search, get destination, get list) take no token.

User-scoped actions accept a Firebase ID token as the first parameter:
1. Client calls `getIdToken()` from `useAuth()` hook
2. Server action calls `verifyToken(token)` from `src/lib/auth-actions.ts`
3. `verifyToken` uses `adminAuth.verifyIdToken()` to decode the JWT and extract `uid`
4. The `uid` scopes all subsequent queries (e.g., `WHERE user_id = $1`)

Admin actions have no server-side auth check — they rely on the client-side `AdminGuard`.

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

Search uses PostgreSQL `pg_trgm` extension for fuzzy text matching with composite scoring:

```
Score = text_similarity × 0.55
      + prefix_bonus    × 0.15    (name starts with query)
      + proximity       × 0.15    (EXP(-distance/500km))
      + elevation       × 0.10    (normalized to 0-1)
      + prominence      × 0.05    (normalized to 0-1)
```

When no lat/lng is available, proximity weight redistributes to elevation (0.15) and prominence (0.10). Browser geolocation is requested on the discover page to enable geo-biased results.

The map explorer uses viewport-based queries (`ST_Intersects` with `ST_MakeEnvelope`) backed by GIST spatial indexes, debounced at 300ms on pan/zoom.

## Session Display Names

Sessions in the database often have `name = NULL`. The display name is derived:
1. Explicit `name` if set
2. Comma-separated destination names from `session_destinations`, sorted by elevation (highest first)
3. Fallback: "Untitled Session"

The `getUserSessions` action batch-fetches destination names for all sessions in one query to avoid N+1.

## Component Architecture

### Navigation
- **`AppNav`** — responsive: top bar on desktop (`hidden md:block`), fixed bottom tabs on mobile (`md:hidden`). Shared across public and auth pages.
- **`AdminNav`** — desktop-only top bar for admin pages.

### Map components
All map components use `react-leaflet` with `next/dynamic` + `ssr: false` (Leaflet requires `window`).

| Component | Purpose |
|-----------|---------|
| `destination-map` | Single marker (destination detail) |
| `route-map` | Polyline6-encoded route |
| `session-map` | GPS breadcrumbs, color-coded by segment |
| `explore-map` | Full-screen with viewport loading, topo/satellite toggle |
| `route-builder-map` | Interactive segment overlays (admin) |
| `location-picker-map` | Draggable marker (admin) |

### Reusable components

| Component | Used by |
|-----------|---------|
| `destination-card` | Discover, list detail, search results |
| `session-card` | Session log |
| `plan-card` | Plans list |
| `trip-report-card` | Report listings |
| `search-bar` | Discover, lists (URL-synced, debounced) |
| `progress-bar` | List detail (completion fraction) |
| `stats-banner` | Session log (lifetime stats) |
| `elevation-profile` | Route detail, session detail |
| `block-editor` | Trip report creation |
| `destination-picker` | Plan creation, report creation |
| `route-picker` | Plan creation |
| `avatar` | Account, friends, party list |
| `friend-card` | Friends page |
| `party-list` | Plan detail |

## Key Design Decisions

### Why two databases?
PostGIS is essential for spatial queries (nearby, viewport, distance calculations). Firestore is already the source of truth for user-owned data in the iOS app and provides real-time sync + simple security rules. Migrating everything to one store would sacrifice either spatial capabilities or iOS compatibility.

### Why server actions instead of API routes?
Server actions eliminate the need for a separate API layer. They're typed end-to-end, colocated with the code that calls them, and handle serialization automatically. The Cloud Run Express API (`cloud-sql/api/`) still exists for the iOS app — the web app doesn't use it.

### Why client-side rendering for most pages?
Most pages use `"use client"` because they need interactive state (auth context, search input, map interactions). Data is fetched in `useEffect` via server actions. This keeps the architecture simple — no RSC/client boundary complexity.

### Why no activity type filter (yet)?
Activity types (`outdoor-trek`, `outdoor-moto`, `ski`) exist in the schema but the web app doesn't expose filtering by them. The iOS app primarily uses `outdoor-trek`. Activity type support can be added later when there's user demand.

### Session naming strategy
The iOS app rarely sets explicit session names. Instead, sessions are identified by their destinations — "Mount Rainier, Camp Muir" is more meaningful than a timestamp. The web app derives names from `session_destinations` sorted by elevation, matching the Strava upload naming pattern in the Cloud Functions.
