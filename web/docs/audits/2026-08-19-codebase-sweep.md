## 1. Stack and architecture

Scope note: this report reflects the working tree as found, including many pre-existing modified and untracked files. I made no changes and did not run commands such as `next build` that would write `.next` output.

- **Framework:** Next.js App Router, not Pages Router. There are 35 `page.tsx` files under `src/app` and no `pages/` directory. The package range is `next ^15.5.7`; the lockfile resolves exactly 15.5.7. React and React DOM are 19.2.3, with TypeScript 5. [package.json](/Users/josiahm/projects/peaks/firebase/web/package.json:11)
- **Version concern:** the lockfile itself marks Next 15.5.7 deprecated because of a security flaw. [package-lock.json](/Users/josiahm/projects/peaks/firebase/web/package-lock.json:6849) The architecture document incorrectly calls this a “Next.js 16 deployment.” [ARCHITECTURE.md](/Users/josiahm/projects/peaks/firebase/web/ARCHITECTURE.md:5)
- **Route organization:** route groups split public and signed-in pages. The public layout supplies `AuthProvider`, `AppNav`, and a mobile bottom offset. [public layout](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/layout.tsx:6>) The signed-in layout adds `UserAuthGuard`. [authenticated layout](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/layout.tsx:8>) Admin pages add `AdminGuard` inside each page rather than at the layout level. [admin layout](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/layout.tsx:5)
- **Rendering:** 33 of the 35 page files start with `"use client"`. The two server pages are the five-line `/` redirect and `/areas/[id]`, which fetches its record server-side. [root page](/Users/josiahm/projects/peaks/firebase/web/src/app/page.tsx:1), [area page](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/areas/[id]/page.tsx:1>)
- **Data-loading pattern:** most pages render on the client, then call Next server actions from `useEffect`. Dynamic destination, route, area, list, and report layouts fetch server-side metadata while their client pages fetch the same base records again after hydration. There are no `generateStaticParams`, `revalidate`, or `force-static` uses. The five detail metadata layouts, area page, and sitemap use `force-dynamic`.
- **Access guards:** both user and admin guards redirect in client effects. There is no Next middleware. [UserAuthGuard](/Users/josiahm/projects/peaks/firebase/web/src/components/user-auth-guard.tsx:7), [AdminGuard](/Users/josiahm/projects/peaks/firebase/web/src/components/admin-guard.tsx:7)
- **Data layer:** 17 `"use server"` action modules query PostgreSQL/PostGIS through a five-connection `pg` pool, use Firebase Admin for Firestore/Auth, or forward GPX imports to the Peaks Cloud Run API. [db.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/db.ts:1), [firebase-admin.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/firebase-admin.ts:1), [actions directory](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions)
- **Styling:** Tailwind CSS 4 through `@tailwindcss/postcss`. There is no Tailwind config, CSS Module, Sass file, or installed component library. [postcss.config.mjs](/Users/josiahm/projects/peaks/firebase/web/postcss.config.mjs:1)
- **Maps:** Leaflet 1.9.4, `leaflet-draw`, and React Leaflet 5. Most map components use Leaflet directly; `SessionMap` uses React Leaflet. The architecture document’s claim that all maps use React Leaflet is stale. [package.json](/Users/josiahm/projects/peaks/firebase/web/package.json:17), [ExploreMap](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:1), [SessionMap](/Users/josiahm/projects/peaks/firebase/web/src/components/session-map.tsx:1)
- **Map tiles:** OpenTopoMap is the default across all nine map components. Area and explorer maps also offer Esri World Imagery. [ExploreMap](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:63), [AreaMap](/Users/josiahm/projects/peaks/firebase/web/src/components/area-map.tsx:48)
- **Charts:** no chart package is installed. Elevation profiles use a hand-written canvas component; destination seasonality uses ordinary div bars. [ElevationProfile](/Users/josiahm/projects/peaks/firebase/web/src/components/elevation-profile.tsx:11)
- **Fonts:** Geist and Geist Mono through `next/font/google`, exposed as CSS variables. [root layout](/Users/josiahm/projects/peaks/firebase/web/src/app/layout.tsx:1)
- **Build policy:** ESLint failures are ignored during Next builds, and server action request bodies allow 20 MB. [next.config.ts](/Users/josiahm/projects/peaks/firebase/web/next.config.ts:47)

## 2. Complete route/page inventory

There are **35 page routes**: 13 accessible without a normal user session, 11 signed-in pages, and 11 admin pages including admin login. “Public” below means the route does not require login; some pages add extra owner-only controls after sign-in.

### Public and authentication routes

| Route | What it renders | State |
|---|---|---|
| `/` | Redirects to `/discover`. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/page.tsx:1) | Complete redirect only. |
| `/discover` | Search across destinations, areas, routes, and lists; nearby destinations; catalog totals; popular destinations/routes; lists; recent reports. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/discover/page.tsx:70>) | Functional but badly overgrown: 930 lines, five data-loading effects, several local card/section types, and heavy explanatory copy. |
| `/map` | Full-screen topo/satellite explorer with viewport-loaded destinations and routes, visibility toggles, counts, and result panels. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/map/page.tsx:33>) | Functional in structure, but it has query and hit-testing defects described in section 7. |
| `/destinations/[id]` | Destination header, areas, save/directions/report actions, personal activity, copy with source, five stats, hero photo, planning notes, map, routes, reports, weather/directions/facilities, seasonality, lists, and nearby places. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/destinations/[id]/page.tsx:69>) | One of the most complete public pages, but an 806-line client component. |
| `/destinations/[id]/reports` | All reports for one destination and a write-report action. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/destinations/[id]/reports/page.tsx:21>) | Functional but visually thin. |
| `/areas/[id]` | Server-fetched protected-area detail: parent area, personal activity, source-backed copy, catalog facts, boundary map, up to 30 destinations, 15 routes, and five recent sessions. [server page](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/areas/[id]/page.tsx:5>), [client body](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/areas/[id]/area-detail-client.tsx:35>) | Rich and fairly coherent; newer than much of the app. |
| `/routes/[id]` | Route guide with areas, directions, five stats, prose, map, provenance, canvas elevation, destinations, segments, external links, and session count. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/routes/[id]/page.tsx:59>) | Rich and close to the existing AllTrails-style specification. |
| `/lists` | Searchable list catalog with 20-item pagination. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/lists/page.tsx:10>) | Functional, simple. |
| `/lists/[id]` | List heading, destination cards, and signed-in completion progress. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/lists/[id]/page.tsx:18>) | Basic and functional, with a privacy flaw in its progress action. |
| `/reports/[id]` | Trip-report title, author/date, linked destinations, text blocks, photos, edit action for the owner, and destination-report links. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/reports/[id]/page.tsx:29>) | Functional; presentation remains basic. |
| `/log/[id]` | Public activity playback when shared; signed-in owner metadata editing, sharing, GPX export, and deletion; summary, synchronized map/elevation/heart rate, areas, destinations, and routes. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/log/[id]/page.tsx:43>) | Strong functional base, but lacks Strava-style identity, social, repeat-effort, and share metadata. |
| `/login` | Email/password, Google, Apple, and password reset in a two-column marketing/auth layout. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/login/page.tsx:20) | Complete flow, with an unchecked `next` target. |
| `/register` | Name/email/password, Google, and Apple registration in the matching layout. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/register/page.tsx:19) | Complete flow, with the same unchecked `next` target. |

### Signed-in routes

All 11 sit below the client-side user guard.

| Route | What it renders | State |
|---|---|---|
| `/log` | Lifetime stats, activity-type filters, paged session cards, and GPX import entry point. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/log/page.tsx:42>) | Functional. |
| `/log/import` | Local GPX validation and preview, activity metadata/privacy, chunked API import, duplicate handling, and processing warnings. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/log/import/page.tsx:40>) | Functional and well bounded; no map preview. |
| `/saved` | Saved-destination cards resolved against SQL, including a warning for Firestore IDs missing from SQL. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/saved/page.tsx:16>) | Functional. |
| `/plans` | Current user’s owned or shared plan cards. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/page.tsx:9>) | Skeletal but functional; weak failure handling. |
| `/plans/new` | Name, notes, date, destination picker, and route picker. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/new/page.tsx:11>) | Basic creation form. |
| `/plans/[id]` | Plan edit, one route map, destinations, routes, party, raw-UID invite, and deletion. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/[id]/page.tsx:25>) | Half-finished relative to server capabilities; only the first route is mapped. |
| `/reports/new` | Title/date, custom destination search, and text/photo block editor. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/reports/new/page.tsx:20>) | Functional text reporting; photo entry requires a Firebase Storage URL. |
| `/reports/[id]/edit` | Owner-checked editing and deletion with the shared pickers/block editor. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/reports/[id]/edit/page.tsx:25>) | Functional, with the same photo limitation. |
| `/account` | Profile summary and links to profile, friends, saved destinations, and sign-out. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/account/page.tsx:10>) | Basic account hub. |
| `/account/profile` | Avatar upload, name edit, and read-only email. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/account/profile/page.tsx:11>) | Basic; advertised image restrictions are not enforced in code. |
| `/account/friends` | Friend list, invite-link generation/copy, invite acceptance, and removal. [source](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/account/friends/page.tsx:15>) | Functional but plain; several missing-token paths leave spinners active. |

### Admin routes

Ten routes are client-guarded by the Firebase `admin` claim; `/admin/login` is the entry page.

| Route | What it renders | State |
|---|---|---|
| `/admin` | Four management tiles and counts. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/page.tsx:7) | Placeholder: all counts are literals and the Lists tile is dead. |
| `/admin/login` | Email/password login plus admin-claim check. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/login/page.tsx:13) | Functional. |
| `/admin/destinations` | Search, filters, sorting, paging, GPX bulk import, and links to add/edit. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/destinations/page.tsx:28) | Substantial and functional. |
| `/admin/destinations/new` | Map-first add flow, nearby SQL/OSM checks, reverse geocoding, elevation, boundary editing, and source selection. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/destinations/new/page.tsx:57) | Substantial 647-line workflow. |
| `/admin/destinations/[id]` | Destination edit, geocoding, boundary editor, image/source details, routes, lists, and session links. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/destinations/[id]/page.tsx:40) | Substantial, but its list links point to missing routes. |
| `/admin/routes` | Active/pending tabs, pending count, search, paging, import/new actions. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/routes/page.tsx:19) | Functional. |
| `/admin/routes/new` | Four-step GPX route builder, trailhead creation, route chopping, segment matching, impact analysis, and save. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/routes/new/page.tsx:43) | Feature-rich but the largest page at 931 lines. |
| `/admin/routes/import` | Multi-GPX pending-route import with source, license, URL, and OSM IDs. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/routes/import/page.tsx:31) | Functional. |
| `/admin/routes/[id]` | Edit route fields, review/accept/reject pending routes, segment analysis, map, destinations, and provenance. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/routes/[id]/page.tsx:31) | Functional. |
| `/admin/sessions` | Search, destination filter, sorting, paging, and user popovers. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/sessions/page.tsx:41) | Functional UI over unsafe unguarded actions. |
| `/admin/sessions/[id]` | Session metadata, points/map/elevation, timing stats, destination matches, and processing state. [source](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/sessions/[id]/page.tsx:34) | Functional UI over unsafe unguarded actions. |

There are no Next `route.ts` handlers. Six special App Router files produce framework routes/assets: [sitemap.xml](/Users/josiahm/projects/peaks/firebase/web/src/app/sitemap.ts:42), [robots.txt](/Users/josiahm/projects/peaks/firebase/web/src/app/robots.ts:4), [manifest.webmanifest](/Users/josiahm/projects/peaks/firebase/web/src/app/manifest.ts:3), [Open Graph image](/Users/josiahm/projects/peaks/firebase/web/src/app/opengraph-image.tsx:12), [Twitter image](/Users/josiahm/projects/peaks/firebase/web/src/app/twitter-image.tsx:12), and `favicon.ico`. There are also 13 loading boundaries, two error boundaries, and two near-identical not-found components.

## 3. Component inventory

There are **45 reusable `.tsx` component files**, 25 of them client components. They divide as follows; every component file is included here.

- **Shell and access:** `AppNav` supplies a desktop top bar and mobile fixed bottom tabs; `AdminNav` supplies one horizontal top bar; `UserAuthGuard` and `AdminGuard` perform client redirects; `UserPopover` lazily resolves a Firebase user. [AppNav](/Users/josiahm/projects/peaks/firebase/web/src/components/app-nav.tsx:22), [AdminNav](/Users/josiahm/projects/peaks/firebase/web/src/components/admin-nav.tsx:15)
- **Identity, plans, and progress:** `Avatar`, `FriendCard`, `PartyList`, `PlanCard`, `SaveDestinationButton`, and `ProgressBar`. They work, but `PlanCard` and `FriendCard` use custom `rounded-xl` shells rather than the shared `Card`.
- **Catalog cards and content:** `AreaCard`, `AreaChip`, `AreaKindIcon`, `icons/ParkShield`, `DestinationCard`, `ListCard`, `RouteCard`, `TripReportCard`, `SessionCard`, `StatsBanner`, `SessionHealthSummary`, `RouteProvenanceNotice`, `RouteExternalLinks`, and `RouteSegmentList`.
- **Detail primitives:** `detail-sections.tsx` exports `DifficultyPill`, `Breadcrumb`, `StatCell`, `StatRow`, `SidePanel`, and `titleize`. These are the most coherent shared detail-screen pieces. [detail-sections.tsx](/Users/josiahm/projects/peaks/firebase/web/src/components/detail-sections.tsx:3)
- **UI primitives:** only three files exist under `components/ui`: `Card`, `Badge`, and `EmptyState`. [Card](/Users/josiahm/projects/peaks/firebase/web/src/components/ui/card.tsx:3), [Badge](/Users/josiahm/projects/peaks/firebase/web/src/components/ui/badge.tsx:1), [EmptyState](/Users/josiahm/projects/peaks/firebase/web/src/components/ui/empty-state.tsx:1)
- **Maps:** nine map components: `AreaMap`, `BoundaryEditorMap`, `DestinationMap`, `DestinationSearchMap`, `ExploreMap`, `LocationPickerMap`, `RouteBuilderMap`, `RouteMap`, and `SessionMap`. They repeat tile setup, marker styling, and in three cases their own polyline6 decoder.
- **Chart/playback:** `ElevationProfile` is the canvas chart. `SessionPlayback` combines that chart with `SessionMap`, playback controls, elapsed distance/elevation/speed, and heart rate.
- **Search, editors, and commands:** `SearchBar`, `DestinationPicker`, `RoutePicker`, `BlockEditor`, and `SessionActions`.

Consistency is partial:

- The newer catalog cards—destination, area, route, list, and trip report—share `Card` and `Badge`. For example, `DestinationCard` is only 51 lines and centralizes feature pills. [DestinationCard](/Users/josiahm/projects/peaks/firebase/web/src/components/destination-card.tsx:12)
- Activity, plan, account, friend, health, map, and editor panels still repeat their own border, radius, padding, hover, and dark-mode strings. `SessionCard` is a clear example of the older style. [SessionCard](/Users/josiahm/projects/peaks/firebase/web/src/components/session-card.tsx:32)
- There is no shared button, input, section heading, page header, tab, modal, icon, metric-row, or form-field component. Across pages and components I counted 120 raw `<button>` elements and 73 raw input/select/textarea elements.
- `RouteExternalLinks` and `RouteSegmentList` have no imports anywhere. The live route page inlines equivalent markup instead.
- Maps form a component family by filename, but not by implementation. `AreaMap` safely builds popup DOM nodes with `textContent`; `ExploreMap` builds raw HTML strings. [safe AreaMap popup](/Users/josiahm/projects/peaks/firebase/web/src/components/area-map.tsx:215), [ExploreMap popup](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:182)
- The canvas chart hard-codes light gray/blue colors and `system-ui`, does not listen for container resize, and has no textual chart alternative. [ElevationProfile](/Users/josiahm/projects/peaks/firebase/web/src/components/elevation-profile.tsx:20)

## 4. Design foundation state

A written design system exists, but the implementation has few real tokens.

- [design-system-spec.md](/Users/josiahm/projects/peaks/firebase/web/docs/design-system-spec.md:1) defines a flat editorial style, gray hairlines, blue actions, type-specific outlined pills, capped radii, and full dark mode. [destination-page-spec.md](/Users/josiahm/projects/peaks/firebase/web/docs/destination-page-spec.md:1) explicitly models destination and route pages on WTA and AllTrails.
- The actual global theme defines only `--background`, `--foreground`, and the two Geist font aliases. There are no brand, semantic, spacing, radius, shadow, or type-scale variables. [globals.css](/Users/josiahm/projects/peaks/firebase/web/src/app/globals.css:1)
- There is no `tailwind.config.*` or theme file. The effective spacing and type scales are Tailwind defaults plus local choices.
- Color is mostly repeated utility text rather than a token system. I counted 401 blue color utilities, 63 teal utilities, and six orange utilities. Blue is the newer action color, teal appears on activity/personal-area treatment, and route pickers still use orange. Leaflet colors are separately hard-coded.
- The spec caps content radii at `rounded-lg`, but current app/component TSX contains 89 `rounded-xl`, `rounded-2xl`, or `rounded-3xl` uses and 25 shadow uses. The newer catalog cards comply; session, account, plan, report, area, and map components often do not.
- There are 28 inline `style=` sites. Some are necessary canvas/map dimensions, but the explorer also embeds full popup layouts as inline HTML/CSS.
- Dark mode is broad: 1,235 `dark:` variants appear across app/component TSX. Global colors follow `prefers-color-scheme`; there is no theme switch or stored user choice. The canvas elevation profile remains light-themed internally.
- Responsive handling is present but uneven. I counted 96 `sm:`, `md:`, `lg:`, `xl:`, or `2xl:` variants. Public layouts stack grids, and `AppNav` changes from desktop top nav to mobile bottom tabs. `AdminNav` has no mobile mode or overflow treatment. [AppNav responsive split](/Users/josiahm/projects/peaks/firebase/web/src/components/app-nav.tsx:29)
- `safe-area-bottom` is placed on the mobile nav, but no CSS utility or rule defines it, so it does not add an iPhone safe-area inset. [AppNav](/Users/josiahm/projects/peaks/firebase/web/src/components/app-nav.tsx:85)
- Typography has useful conventions in the written spec and detail helpers, but pages still choose among `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl`, uppercase eyebrows, and 11 arbitrary text sizes locally.
- The manifest’s dark slate theme colors are another standalone color decision rather than a shared token. [manifest.ts](/Users/josiahm/projects/peaks/firebase/web/src/app/manifest.ts:3)

## 5. Data availability

The current backend has far more depth than the web interface suggests.

### Data architecture

- PostgreSQL/PostGIS defines **25 tables** for destinations, lists, protected areas, route segments/routes, plans, sessions, points, groups, markers, and their relationships. [schema.sql](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:118)
- The web has **17 server-action files**. Catalog, route, map, and session actions query SQL directly. Profiles, friends, invites, saved destinations, and trip reports use Firestore. Plans use Firestore as the web source and asynchronously mirror to SQL. [plans.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/plans.ts:44)
- The Cloud Run API exposes **58 handlers**: 38 reads and 20 writes across destinations, routes, areas, lists, plans, search, and sessions. All `/api` routes require Firebase Auth. [API entry](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/index.ts:24)
- The web only calls that API directly for GPX activity import. The rest of the Next app uses direct SQL or Firebase Admin server actions. [session-import.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/session-import.ts:43)

### Sessions and activities

Already surfaced:

- Session list, filters, totals, distance, time, pace, gain, high point, activity type, privacy, areas, GPS points, elevation/speed playback, heart rate and energy, reached/goal destinations, routes, metadata editing, share, GPX export, and deletion.
- Public sessions use a separate bundle that strips owner UID and health data. [public-sessions.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/public-sessions.ts:53)

Available but not surfaced:

- `ascent_time`, `descent_time`, `still_time`, import `source`, external ID, upload-to-Strava state, source-contribution records, processing state/error, smart-link `group_id`, and repeat-attempt `attempt_group_id`. [tracking_sessions schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:514)
- Tracking points also carry azimuth, HDOP, speed accuracy, and geohash; web actions select only elevation and speed. [tracking_points schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:579)
- Route matches store `source` and `coverage`; the Cloud Run response includes both, but the Next action and UI omit them. [API session routes](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/routes/sessions.ts:684)
- Session markers have full read/create/delete API support and are absent from the web. [markers API](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/routes/sessions.ts:703)
- Smart-linked multi-day session groups have read/create/join/leave/merge/rename API support; the web has no action or UI for them. [group API](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/routes/sessions.ts:833)
- Repeat-attempt groups are created during session processing but are not returned by a dedicated web action or shown as past attempts. [attempt-group schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:502)

### Routes and efforts

Already surfaced:

- Public route geometry, distance, gain/loss, shape, completion mode, elevation profile, areas, destinations, ordered segments, session count, provenance, directions, estimated time/difficulty, and external links. [routes action](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/routes.ts:13)

Available but not surfaced:

- Route geohashes, segment provenance, route-match coverage/source, pending/processing state outside admin, and a user’s history on that route.
- There is **no named “effort” entity** in schema, web actions, or API code. Strava-style efforts could be derived from `session_routes.coverage`, tracking points, and `session_attempt_groups`, but that product layer does not yet exist.
- There are no leaderboards, segment times, personal records, or per-route attempt lists.

### Destinations and places

Already surfaced:

- Names, type/features, elevation, prominence, location and boundary, country/state, hero image with credit, sourced description, amenities, month seasonality, routes, lists, session/report counts, nearby places, protected areas, and signed-in personal visit totals. [destination action](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/destinations.ts:44)

Available but unused or only partly used:

- `activities` are fetched but not displayed on public destination detail.
- Destination weekday averages are merged into the data object, but only month bars are shown.
- Historical session/success offsets, metadata, external IDs, explicit-save state, recency, and raw geohash are stored but not presented. [destination schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:118)
- `getUnclimbedDestinations` already queries personal unvisited destinations, but nothing imports it. [search.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/search.ts:385)

### Protected areas

Protected areas are first-class and already well surfaced:

- Search results, dedicated detail pages, source-backed descriptions, parent relationships, manager/designation, state/country, catalog counts, simplified display boundaries, destination and route lists, and personal sessions.
- Destination, route, and session pages show area chips.
- SQL also stores full source metadata, exact and simplified boundaries, subdivided parts, and link sources/relations. [area schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:209)

### Plans

The web exposes Firestore plan name, notes, date, destination IDs, route IDs, and party IDs.

SQL and the API also support:

- Full plan geometry, total distance/gain, processing state/error/timestamps, ordered route records, and auto-matched reached destinations along the route. [plan schema](/Users/josiahm/projects/peaks/firebase/cloud-sql/schema.sql:404), [reached-destination API](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/routes/plans.ts:267)
- None of those processed plan fields appear in the web plan model or page. The web map shows the first route polyline only. [plan page](/Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/[id]/page.tsx:164)

### Photos and reports

- Destination hero images live in SQL and appear on destination pages.
- Trip reports live in Firestore. The web normalizes both its block model and the iOS `content`/`headerPhotos` model, and writes both forms for compatibility. [trip-reports.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/trip-reports.ts:84)
- The report reader renders photos, captions, and header-photo metadata. The editor cannot upload a file; it accepts only an existing Peaks Firebase Storage download URL. [BlockEditor](/Users/josiahm/projects/peaks/firebase/web/src/components/block-editor.tsx:191)
- Report attachments are always written as `{route:false, timeline:false}`. [trip-reports.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/trip-reports.ts:529)
- Avatars upload to Firebase Storage.
- I found no session-photo schema, API, or UI. `session_markers.image` is an icon/custom-asset name, not an activity photo gallery.

### Stats, social, weather, and air quality

- Existing stats include lifetime session/distance/gain/time/reached-destination totals, per-destination and per-area personal totals, catalog counts, route session counts, destination averages, and popular destination/route queries.
- There is a Firestore friends model and plan parties, but no activity feed, follow graph, kudos, likes, comments, clubs, ratings, reviews, or public athlete-profile page. A Strava-first social layer therefore needs backend work, not just a restyle.
- Firestore rules expose a public `weather` collection, and Cloud Functions contains `getDestinationWeather`, but the web has no weather action. It links to NOAA for US coordinates instead. [firestore.rules](/Users/josiahm/projects/peaks/firebase/firestore.rules:59), [destinationHelpers.ts](/Users/josiahm/projects/peaks/firebase/functions/src/destinationHelpers.ts:25)
- Cloud Functions refresh and query avalanche forecast polygons, but no web code calls them. [avalanche functions](/Users/josiahm/projects/peaks/firebase/functions/src/index.ts:950)
- Functions also contain Strava token/upload, premium receipt, and notification code that the web account/activity UI does not expose. [function exports](/Users/josiahm/projects/peaks/firebase/functions/src/index.ts:368)
- I found **no air-quality or AQI model, action, API, function, or UI** anywhere outside dependencies. This data is not currently available.

## 6. Feasibility map

| Cost | Scope | Evidence |
|---|---|---|
| Cheap | Restyle destination, area, route, list, and trip-report cards. | They already share three small UI primitives; card files range from 31 to 54 lines. A `Card`/`Badge` change reaches five card types. |
| Cheap | Establish real color, type, radius, and spacing tokens; add a dark-mode choice. | Tailwind 4 and CSS variables already exist, but `globals.css` contains only two color variables and two font aliases. |
| Cheap | Restyle list browsing, saved items, plan lists, account links, friend cards, stats banners, and loading/empty states. | Their data and navigation are already split from presentation; most are short pages composed from existing cards. |
| Cheap to medium | Bring destination and route details closer to the target style without changing data. | Both already have the intended information order and shared `Breadcrumb`, stat, difficulty, and sidebar primitives. Their size makes review important, but the backend work is done. |
| Medium | Restyle activity log/detail around a Strava-like activity card and summary. | Session data and playback components are already reusable, but `SessionCard`, `StatsBanner`, health, and detail sections use separate shells and formatting. |
| Medium | Replace map page chrome while retaining Leaflet. | The visible control panels are isolated in `map/page.tsx`, but interaction defects must be fixed before visual work. |
| Medium to expensive | Rework trip-plan detail. | Destination/route/party components exist, but the page performs N per-record action calls, maps only one route, hides SQL processing data, and handles errors only through `console.error`. |
| Expensive | Turn Discover into a polished Strava/AllTrails home/search surface. | [discover/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/discover/page.tsx:70>) is a 930-line client monolith combining geolocation, four-way search, five content sections, URL state, copy, and local card types. |
| Expensive | Rebuild the explorer interaction. | [map/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/map/page.tsx:33>) plus [explore-map.tsx](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:72) total 572 lines, mix React overlays with imperative Leaflet, duplicate route rendering, and embed popup HTML strings. |
| Expensive | Add Strava-style feed, profiles, social proof, efforts, leaderboards, and repeat-attempt views. | There are no matching schemas/actions/pages beyond friends and session attempt grouping. This is product and backend work. |
| Expensive | Admin route/destination workflow redesign. | `admin/routes/new/page.tsx` is 931 lines, `admin/destinations/new/page.tsx` 647, and `admin/destinations/[id]/page.tsx` 627. They mix workflow state, forms, maps, imports, geocoding, and writes in single page files. |

The worst-quality user-facing areas by structure are:

1. [discover/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/discover/page.tsx:70>) — 930 lines and too many concerns.
2. [destinations/[id]/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/destinations/[id]/page.tsx:69>) — 806 lines despite good information coverage.
3. [map/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/map/page.tsx:33>) and [explore-map.tsx](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:72) — interaction and safety debt.
4. [plans/[id]/page.tsx](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/[id]/page.tsx:25>) — hidden backend capability, N+1-style record loads, and silent failures.
5. [BlockEditor](/Users/josiahm/projects/peaks/firebase/web/src/components/block-editor.tsx:11) — 274 lines for a rudimentary URL-based block form.
6. The three large admin builders noted above.

An AllTrails-style catalog/detail overhaul is much cheaper than a true Strava-first overhaul. Place, area, and route data are already rich. The missing Strava pieces—feed, athlete profiles, social actions, efforts, records, repeat-attempt presentation, and activity photos—do not yet have a web data model.

## 7. Anything obviously broken, half-finished, or placeholder

- **Admin server actions lack server-side authorization.** The repository documents this explicitly: “Admin actions have no server-side auth check.” [ARCHITECTURE.md](/Users/josiahm/projects/peaks/firebase/web/ARCHITECTURE.md:87) `updateDestination`, route accept/reject/save, and all admin session reads accept no token or admin claim. [updateDestination](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/destinations.ts:341), [admin session reads](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/admin-sessions.ts:34) A client guard does not protect a server action endpoint. The session actions expose private user IDs, activity metadata, and GPS points.
- **Other personal-data actions are also unguarded.** `getListProgress(listId,userId)` and unused `getUnclimbedDestinations(userId,…)` accept arbitrary user IDs without a token. [list progress](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/lists.ts:154), [unclimbed destinations](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/search.ts:389)
- **`getUser(uid)` has no caller check and returns email and profile data.** It is callable from plan party and admin popover code with arbitrary UIDs. [users.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/users.ts:15)
- **Some Cloud Run plan child endpoints miss plan-membership checks.** `/plans/:id/destinations`, `/plans/:id/routes`, and `/plans/:id/party` require a signed-in API caller globally, but do not check that the caller owns or belongs to that plan. [plans API](/Users/josiahm/projects/peaks/firebase/cloud-sql/api/src/routes/plans.ts:250)
- **Explorer popup HTML is not escaped.** Destination names, feature strings, route names, and IDs are interpolated into strings passed to Leaflet `bindPopup`. [explore-map.tsx](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:182) Imported or admin-edited content can become HTML.
- **The map overlay likely blocks map interaction across most of the viewport.** A full-height inner overlay container sets `pointer-events-auto`, while only its panels should be interactive. [map page](/Users/josiahm/projects/peaks/firebase/web/src/app/(public)/map/page.tsx:103)
- **Discover sends search text to a map that ignores it.** Discover creates `/map?q=…`; the map page never reads `useSearchParams` or `q`. [link construction](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/discover/page.tsx:385>), [map state](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/map/page.tsx:33>)
- **Route drawing is duplicated.** `ExploreMap` draws routes once when `routes` change and repeats almost the same code in a `zoomend` handler. [first path](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:203), [second path](/Users/josiahm/projects/peaks/firebase/web/src/components/explore-map.tsx:239)
- **Admin Lists is a dead feature.** The nav, dashboard, and destination detail link to `/admin/lists` and `/admin/lists/[id]`, but neither route exists. [AdminNav](/Users/josiahm/projects/peaks/firebase/web/src/components/admin-nav.tsx:7), [dashboard](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/page.tsx:7), [destination list link](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/destinations/[id]/page.tsx:530)
- **Admin dashboard counts are literals:** 5,193 destinations, 324 routes, 991 sessions, and 15 lists. [admin page](/Users/josiahm/projects/peaks/firebase/web/src/app/admin/page.tsx:7)
- **Next 15.5.7 is flagged as vulnerable by its own lockfile.** [package-lock.json](/Users/josiahm/projects/peaks/firebase/web/package-lock.json:6849)
- **Login and registration trust the `next` query value.** Both pass it directly to `router.replace` after auth without requiring a local path. [login](/Users/josiahm/projects/peaks/firebase/web/src/app/login/page.tsx:35), [register](/Users/josiahm/projects/peaks/firebase/web/src/app/register/page.tsx:28)
- **Plan edit failures are invisible.** Save, invite, and delete errors only go to `console.error`; users get no message. The plan map selects the first route with a polyline rather than combining the plan. [plan handlers](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/[id]/page.tsx:110>), [first route](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/[id]/page.tsx:164>)
- **Plan pickers show truncated database IDs for existing selections.** The detail page does not pass its loaded destination names to `DestinationPicker`; `RoutePicker` has no initial-name prop at all. [DestinationPicker fallback](/Users/josiahm/projects/peaks/firebase/web/src/components/destination-picker.tsx:93), [RoutePicker fallback](/Users/josiahm/projects/peaks/firebase/web/src/components/route-picker.tsx:65)
- **The signed-in route picker can return pending routes.** It calls the general admin-oriented `getRoutes` without an `active` status filter. [RoutePicker](/Users/josiahm/projects/peaks/firebase/web/src/components/route-picker.tsx:23)
- **Several loading states can stick forever.** `/plans` returns early on a missing token without clearing `loading`; friends load/generate/accept handlers have the same pattern. [plans page](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/plans/page.tsx:14>), [friends page](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/account/friends/page.tsx:38>)
- **Web avatar updates do not flow to all consumers.** Profile editing writes `avatarUrl`, while `getUser` looks for `avatar`; it also expects `name.first/name.last` while profile editing writes a string name. Party lists and user popovers can therefore miss web-updated names and avatars. [profile write](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/profile.ts:40), [user read](/Users/josiahm/projects/peaks/firebase/web/src/lib/actions/users.ts:25)
- **The stated avatar limit is only copy.** The UI says “JPG, PNG. Max 5MB,” but accepts `image/*`, checks neither size nor MIME subtype, and uploads the raw file. [profile page](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/account/profile/page.tsx:130>), [storage helper](/Users/josiahm/projects/peaks/firebase/web/src/lib/storage.ts:6)
- **Trip-report photo creation is developer-facing.** The editor asks normal users for a “Peaks Firebase Storage image URL”; there is no upload control. [BlockEditor](/Users/josiahm/projects/peaks/firebase/web/src/components/block-editor.tsx:192)
- **Unused or abandoned code:** `RouteExternalLinks`, `RouteSegmentList`, exported `acceptRoute`, `batchImportRoutes`, `saveRoute`, and `getUnclimbedDestinations` have no consumers. The default Create Next App SVG assets in `public/` are also unused.
- **The report page uses `prose dark:prose-invert` without installing or configuring Tailwind Typography.** Its explicit paragraph classes do most of the visible work, but those two classes are inert. [report page](</Users/josiahm/projects/peaks/firebase/web/src/app/(public)/reports/[id]/page.tsx:185>)
- **Public activity sharing is incomplete for search/social previews.** `/log/[id]` has no dynamic metadata layout, while `robots.ts` disallows all `/log` paths. Shared activities therefore use generic site metadata and are excluded from crawling. [robots.ts](/Users/josiahm/projects/peaks/firebase/web/src/app/robots.ts:10)
- **An authenticated-group `/log/[id]/loading.tsx` remains even though the page moved to the public route group.** It is orphaned from the live public page hierarchy. [orphan loading file](</Users/josiahm/projects/peaks/firebase/web/src/app/(authenticated)/log/[id]/loading.tsx:1>)
- **Documentation is stale.** Besides the Next 16 claim, `ARCHITECTURE.md` says the web does not use Cloud Run, though GPX import does. [stale claim](/Users/josiahm/projects/peaks/firebase/web/ARCHITECTURE.md:205) The README is untouched Create Next App boilerplate, points to nonexistent `app/page.tsx` instead of `src/app/page.tsx`, and describes Vercel deployment rather than this Firebase/App Hosting setup. [README.md](/Users/josiahm/projects/peaks/firebase/web/README.md:1)
- **Test coverage is nearly absent for the UI.** The web has two tests—report-photo URL normalization and GPX parsing—and no component, route, accessibility, interaction, or visual tests. [report-photo-url.test.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/report-photo-url.test.ts:1), [session-import.test.ts](/Users/josiahm/projects/peaks/firebase/web/src/lib/session-import.test.ts:1)

Codex session ID: 01a01ca5-3d3f-7a93-b2db-807dd86ae2c3
Resume in Codex: codex resume 01a01ca5-3d3f-7a93-b2db-807dd86ae2c3
