# Peaks Web Overhaul — Implementation Plan

Spec: `web/docs/audits/` (5 audit files, 2026-08-19) + the gap-audit artifact. The audits are the binding authority on measured facts and target patterns. Direction: Strava-first, AllTrails fallback for catalog/place pages, and the Peaks iOS design rules win all conflicts.

Repo: this worktree (`firebase-web-overhaul`), branch `web-overhaul` off `origin/main`. The web app is `web/` (Next.js 15 App Router, Tailwind 4, React 19).

## Global Constraints

1. **iOS design rules are law:** no box inside a box; never box a stat; one filled primary action per surface; sections separate by whitespace, not dividers; flat interiors with hairline dividers inside containers only.
2. **Color only through tokens** (after Task 7 lands): no raw Tailwind palette utilities (`blue-600`, `gray-900`, …) in any file a task creates or modifies. Before Task 7, don't introduce new colors at all.
3. **Two text weights** (400/500) for Geist text; display face (Archivo) only at ≥32px sizes; **every stat numeral in Geist Mono** with the unit as a smaller inline span; stat labels 12px muted sentence-case.
4. **Accent budget:** teal on at most one filled primary action per surface + active-nav marker + in-component links. Never on headings, body copy, stat values, chart series, or large backgrounds. Semantic alert color is `--alert`, separate from accent.
5. **No hover lift/scale/shadow-grow.** Text links underline on hover. Buttons may darken fill slightly (≤8%). Shadows only on floating chrome (sticky bars, dropdowns, map controls).
6. **Never print a null or raw enum.** Missing data → omit the element. Unknown values never reach copy.
7. **Verification per task:** `cd web && npm run build` passes; `npm test` (if script exists) passes; no new ESLint errors in changed files (`npx eslint <changed files>`).
8. **No prod database writes. No new external service accounts or API keys.** Data fixes that need SQL go to `web/scripts/data-fixes/*.sql` as reviewed scripts, never executed.
9. Admin pages (`/admin/*`) are out of scope except where a shared component passively restyles them; do not break them.
10. Commit per task with a clear message; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
11. Copy follows the audits' voice rules: short declaratives, second person, plain nouns for section titles, honest precision (round time estimates to quarter-hours; never fake precision), sentence case everywhere except 11–12px eyebrow labels.
12. Dark mode: both themes must work for anything touched; colors come from the token pairs, never one-off `dark:` hexes.

## Design Tokens (authoritative values — Task 7 implements, later tasks consume)

Light theme:
- `--color-ink #21211F` (primary text), `--color-ink-2 #43423F`, `--color-muted #64635E`, `--color-faint #8B8880`
- `--color-border #E0E0DE`, `--color-hairline #EDECE8`, `--color-fill #F2F2F0`, `--color-surface #F9F8F5`, `--color-page #FFFFFF`
- `--color-accent #46ADBC` (brand teal fill; progressive enhancement `color(display-p3 0.332 0.674 0.729)`) — primary buttons use accent fill + ink text
- `--color-accent-text #1D7A8A` (links/active states on light; AA on white)
- `--color-alert #BA4C21`; `--color-success #2C6E49`
Dark theme (warm, not slate): page `#181816`, surface `#201F1D`, fill `#26251F`… wait no: fill `#282722`, hairline `#2E2D29`, border `#3A3936`, ink `#ECEAE6`, ink-2 `#C6C3BC`, muted `#96938A`, accent stays `#46ADBC`, accent-text `#7CC7D4`, alert `#E06A48`.
Type:
- Display: Archivo via `next/font/google`, variable, `font-variation-settings: "wdth" 125`, weight 620–700, sizes 32/40/52/64px, letter-spacing −0.015em, only for page H1s and marketing headings.
- Text: Geist 400/500 only. Body 16/1.55; small 14; meta/labels 12–13 with +0.01em tracking; eyebrows 11–12px uppercase 500 +0.1em muted.
- Numerals: Geist Mono. StatCluster scales: hero 56px/300, page 36px/300, topline 28px/300, card 20px/400 — value + smaller inline unit span (≈0.6em, ink-2), label 12px muted below.
Radius: 6px controls/inputs, 16px media/containers, 9999px chips. Shadows: `--shadow-float: 0 6px 16px rgb(0 0 0 / 0.07), 0 0 1px rgb(0 0 0 / 0.2)` — floating chrome only.
Layout: content `max-w-[1200px]` px-6; marketing section rhythm 112px; app section rhythm 48px; prose measure ~68ch.

---

## Phase 0 — credibility + share layer

### Task 1: Detail-page credibility fixes
Files: `web/src/app/(public)/destinations/[id]/page.tsx`, `web/src/app/(public)/routes/[id]/page.tsx`, `web/src/app/(public)/areas/[id]/area-detail-client.tsx`, related lib/actions formatting helpers (create `web/src/lib/format.ts` for shared formatters).
Requirements (evidence in `web/docs/audits/2026-08-19-peaks-self-audit.md` §2):
- Route pages: never render "Unknown shape" — when shape is null/unknown, omit the shape word/sentence clause entirely (all 4 occurrences). Hide `Elevation loss` when 0/null on non-loop routes. Round time estimates to friendly ranges ("Est. 3.5–5 hr"). Remove "Climbing density" stat. Waypoint labels: named waypoints keep names; unnamed become "Waypoint" only between real Start/Finish labels, numbered sensibly. One name for session counts everywhere: "N sessions". Merge duplicate directions links into one.
- Destination pages: expand ISO region codes to full names (create `web/src/lib/regions.ts` with ISO 3166-1/2 lookup for the countries/states in the catalog; fall back to hiding the row, never showing a raw code). `Type` row: map enum values to display names ("Point" → omit the row; "summit" → "Summit" etc.). Show elevation once in the stat row (remove duplicates in About prose and sidebar). Coordinates: keep one compact row formatted `47.4880° N, 121.7220° W` with copy button. Remove templated About sentences that duplicate the stat row; drop "Planning notes" lines whose claim contradicts on-page counts (e.g. activity claims when sessions = 0).
- Area pages: expand `Designation` codes (WA→Wilderness Area, NP→National Park, etc. — PAD-US designation code table), `Manager` codes (NPS→National Park Service, …), region codes. Single source credit line ("Boundary data: USGS PAD-US 4.1") in muted small text once.
- Difficulty: where difficulty is auto-derived (routes), gate display behind plausibility — if grade would be "Moderate" for >3000 ft gain routes, hide difficulty instead. Simple heuristic, documented in code.
Verification: build; grep the built pages' source for "Unknown", raw ISO codes in the changed components.

### Task 2: Discover + lists credibility fixes
Files: `web/src/app/(public)/discover/page.tsx`, `web/src/app/(public)/lists/page.tsx`, `web/src/app/(public)/lists/[id]/page.tsx`, `web/src/lib/actions/search.ts` + `lists.ts` (read paths only).
Requirements (audit §2 discover/lists):
- "Popular" modules must query with real thresholds: destinations require `session_count >= 3` (including offsets) ordered by count desc; if the query returns <6 rows, retitle the section "Worth a look" and fill with destinations that have hero images. "Popular searches" chips: replace DB-slice with a curated constant list (Rainier, Whitney, Hood, Katahdin, Mount Si, Camp Muir style names — pick 6 real catalog entries by searching for them; hardcode ids+names in a constant with a comment).
- One route-count source: rail and cards read the same number.
- Replace `0`-flash: loading skeleton placeholders (pulse block) until data arrives.
- "Recent trip reports": only show reports from the last 18 months; if none, drop the section entirely.
- Remove the "Nearby objectives / Location is off" permanent failure card: only render the nearby section when geolocation succeeded.
- Remove the duplicated "Sign In" link (keep the right-side auth cluster).
- Lists: normalize `\n` escapes to paragraphs at render; default sort list detail by elevation desc (stable); source URLs become a small "Source: peakbagger.com" link (linked, muted) not body copy; replace byte-identical boilerplate descriptions with nothing (omit) — keep real descriptions only. Fix double type-chip stacking (max 1 chip + "+1" overflow).
- Create `web/scripts/data-fixes/2026-08-19-list-content.sql` (NOT executed) fixing: "Kosiuszko"→"Kościuszko" typo, "Ultras Of Iran"→"Ultras of Iran".
- One loading string constant `LOADING_LABEL = "Loading…"` in `web/src/lib/constants.ts`; replace both variants everywhere.
- Date formatting: one `formatDate` in `web/src/lib/format.ts` (e.g. "Aug 27, 2022") used by discover cards and report pages.

### Task 3: Forms, focus, and auth hardening
Files: `web/src/app/login/page.tsx`, `web/src/app/register/page.tsx`, discover search input, `web/src/app/globals.css` (focus utility only).
Requirements (audit §2 login/register; codebase sweep §7):
- All inputs get `id`, `name`, `<label htmlFor>`, correct `type`, and `autocomplete` (`email`, `current-password`, `new-password`, `name`).
- OAuth buttons become `type="button"` (Enter in email form submits email sign-in).
- Validate `next` param: only paths starting with `/` and not `//` are honored; else fall back to default.
- Client-side password minimum 8 chars with inline message (server stays as-is).
- Global `:focus-visible` style: 2px outline `currentColor`-based offset 2px (pre-token; Task 7 switches it to accent). Remove `outline-none` on the search input or pair it with a visible replacement.
- Keep both pages rendering the shared header/nav (import the existing `AppNav` for now).

### Task 4: Metadata + Open Graph layer
Files: metadata layouts for destinations/routes/areas/lists/reports (`layout.tsx` files with `generateMetadata`), NEW `web/src/app/(public)/log/[id]/` metadata, `web/src/app/opengraph-image.tsx` (exists), new per-entity `opengraph-image.tsx` routes, root `layout.tsx` metadata.
Requirements:
- Title templates: `%s | Peaks` everywhere via root metadata template; list detail + reports get real titles (report title from its data — the h1 must also use the real title, author display name from its stored profile if available, else "A Peaks member").
- Meta descriptions become sentences: destination "Mount Si: 4,167 ft summit in Washington. Routes, conditions, seasonality, and 312 recorded ascents on Peaks."; route "Camp Muir Route: 4.1 mi, 4,677 ft gain on Mount Rainier. Route guide with elevation profile and waypoints."; area/list/report analogous. Reuse formatters from `web/src/lib/format.ts`.
- og:image: root default wired into metadata (the existing `/opengraph-image`); per-entity dynamic OG images via `ImageResponse` for destinations/routes/areas: name + elevation/stats + wordmark on a `#181816` panel (no external fetches). `twitter:card summary_large_image` consistently.
- Reports: og:image must NOT use raw Firebase Storage URLs (bucket+token leak) — use the generic OG image.
- `/log/[id]`: add `generateMetadata` (title = activity name, description = distance/gain/time summary, generic OG); robots meta `noindex` on it, and change `robots.ts` to allow `/log/` fetching (so link unfurlers that respect robots can read OG) while the page-level noindex keeps it out of the index.
Verification: build; `curl` the built HTML head of one page per type via `next start` if quick, else inspect rendered metadata via build output.

### Task 5: SEO infrastructure
Files: `web/src/app/sitemap.ts` (→ sitemap index + per-type sitemaps), new `web/src/app/icon.svg`/`apple-icon.png` conventions, `web/src/app/manifest.ts`, `web/src/app/robots.ts`, JSON-LD components in detail metadata layouts.
Requirements:
- Sitemap: use Next's `generateSitemaps` to split by type+chunk (≤40,000 URLs each); index at `/sitemap.xml`.
- JSON-LD: destinations → `Mountain`/`Place` (name, geo, elevation), areas → `Park`/`Place`, routes → `Place` with distance props, lists → `ItemList`. Inject via `<script type="application/ld+json">` in the pages' server layouts.
- Icons: create a simple mountain-glyph `icon.svg` consistent with the existing favicon (two-triangle summit mark in `#46ADBC` on transparent; keep it minimal), plus `apple-icon` 180px PNG generated with ImageResponse (App Router `apple-icon.tsx`). Manifest: name/short_name "Peaks", `theme_color #181816`, `background_color #181816`, icons pointing at the new assets.
- robots.ts: keep `/admin`, `/account`, `/plans`, `/reports/new`, `/login`, `/register` disallowed; allow `/log/` (Task 4 adds noindex); keep `/map` disallowed (JS-only app page).

### Task 6: Next.js security upgrade
Files: `web/package.json`, lockfile.
Requirements: upgrade `next` to the latest patched 15.x, `npm install`, fix any breakage, build + tests green. Note the resolved version in the commit message.

## Phase 1 — design foundation

### Task 7: Tokens + fonts
Files: `web/src/app/globals.css`, `web/src/app/layout.tsx` (font loading), `web/docs/design-tokens.md` (new — document every token + usage rule).
Requirements: implement the Design Tokens section above exactly, as Tailwind 4 `@theme` variables (so `bg-surface`, `text-ink`, `text-muted`, `border-hairline`, `text-accent-text`, `bg-accent`, `font-display`, `font-mono-num` utilities exist). Load Archivo via `next/font/google` (variable, with `wdth` axis) exposed as `--font-display`; Geist/Geist Mono already loaded. Root layout: `bg-page text-ink` base; dark tokens via `.dark`/media strategy consistent with current approach BUT tokenized (single definition point). Global focus-visible ring in accent. Body default 16px/1.55. Document in design-tokens.md: the accent budget, two-weight rule, stat cluster spec, radius/shadow rules (copy from Global Constraints + Design Tokens sections).

### Task 8: Primitive components + footer + legal pages
Files: `web/src/components/ui/` — new `button.tsx`, `field.tsx` (Input/Select/Textarea + Label), `stat.tsx` (StatCluster: props value/unit/label/scale hero|page|topline|card), `section-heading.tsx` (heading + optional eyebrow), `page-header.tsx` (breadcrumb slot + display H1 + meta row slot), `tabs.tsx`, `chip.tsx`; update `card.tsx`, `badge.tsx`, `empty-state.tsx` to tokens; unify `breadcrumb` (in `detail-sections.tsx`) to `›` separator; new `web/src/components/site-footer.tsx`; new pages `(public)/about`, `(public)/privacy`, `(public)/terms`.
Requirements:
- Button variants: `primary` (accent fill, ink text, 6px radius, 500 weight, h-10 px-4), `secondary` (page fill, border, ink text), `quiet` (transparent, accent-text label), `danger` (alert outline). No size sprawl: `md` + `sm` only.
- StatCluster per token spec — Geist Mono value, inline unit span, 12px muted label, never any background/border.
- Footer: surface background, 4 columns (Explore: Discover/Map/Lists/Areas · Activity: Log/Plans/Trip reports · Company: About/App Store link `https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000` · Legal: Privacy/Terms), plus a bottom line "© 2026 Peaks · Data: OpenStreetMap contributors, USGS PAD-US, Peakbagger" with proper links. 14px/400 ink-2 links, no underline until hover.
- About: short honest page — what Peaks is (peak-bagging tracker + guidebook, iOS app + this site), the catalog numbers, contact mailto, App Store link. Privacy/Terms: solid standard drafts for an activity-tracking app that stores location data (plain language, sections for data collected, storage, sharing, deletion, contact; terms with acceptable use, liability, subscriptions n/a). Mark both pages' frontmatter comment `<!-- DRAFT: legal review pending -->`.
- EmptyState: icon-less — headline + one sentence + optional action button, muted, centered, no box.

### Task 9: Navigation + layouts + 404
Files: `web/src/components/app-nav.tsx` (rebuild), `(public)/layout.tsx`, `(authenticated)/layout.tsx`, `login`/`register` pages (header presence), `not-found.tsx` (both), root `layout.tsx`.
Requirements:
- Desktop nav 56px: wordmark "Peaks" (display face, 20px) → Discover, Map, Lists, Areas → right cluster: search affordance (link to /discover focus), then signed-out: quiet "Log in" + primary "Get the app" (App Store URL); signed-in: Log, Plans, avatar menu (Account, Saved, Friends, Sign out). White/page background, hairline bottom border, no shadow until scrolled (sticky, add shadow-float when scrolled — small client hook).
- Mobile: keep bottom tab bar but ALSO a slim top bar with wordmark + primary CTA (fixes the invisible-brand bug); define `.safe-area-bottom` properly (`padding-bottom: env(safe-area-inset-bottom)`).
- Active nav item: accent-text + 2px accent underline offset. One "Sign In"/"Log in" total.
- Login/register/404 render the nav. 404: h1 display "Nothing at this elevation." + 4 useful links (Discover, Map, Lists, home) + search hint. Proper h1, title "Not found | Peaks".
- Footer (Task 8) mounted in public + authenticated layouts.

### Task 10: Token sweep of secondary pages
Files: `(authenticated)/` pages: `log/import`, `saved`, `plans` (list+new), `reports/new`, `reports/[id]/edit`, `account/*`; shared components they use (`plan-card.tsx`, `friend-card.tsx`, `progress-bar.tsx`, pickers, `block-editor.tsx` styling only). EXCLUDED (Task 17 redesigns them — don't touch): `log/page.tsx`, `session-card.tsx`, `stats-banner.tsx`.
Requirements: mechanical restyle to tokens + primitives (Buttons, Fields, StatCluster for stats-banner, EmptyState). Remove raw palette utilities and ad-hoc `rounded-*`/`shadow-*`; fix the stuck-loading paths flagged in the codebase sweep (`plans/page.tsx` early return without clearing loading; friends handlers same — always `finally { setLoading(false) }` and render an error line). No layout redesign — spacing/color/typography conformance only.

## Phase 2 — the face

### Task 11: Landing page
Files: new `web/src/app/(public)/page.tsx` replacing the redirect (move current redirect: `/` becomes the landing; `/discover` unchanged), assets under `web/public/`.
Requirements:
- Hero: generated topographic-contour backdrop (inline SVG component, seeded polygon rings in `--color-hairline` on page background, one ring stroked accent with a small summit dot; subtle, behind text; no animation beyond a single slow reveal respecting reduced-motion). Display headline (real positioning, from login copy): "Built for serious mountain progress." Subline: one sentence: track ascents, plan routes, and browse 58,000+ peaks. Primary CTA "Get the app" (App Store URL) + quiet secondary "Browse peaks →" (/discover). App screenshots row if assets exist in `web/public/app/` (screenshot files will be provided; build the component to render however many exist, device-framed with 16px radius, no shadow).
- Below: unboxed stat row (Geist Mono): destinations, protected areas, routes, lists — live counts from the existing catalog-count action, server-rendered.
- Three feature blocks (flat, image-optional, Strava recipe: 22px/500 title + one sentence): Map-first planning / Track your ascents / Trip reports that help the next person. No cards.
- Curated entry rows: "Start exploring" — 6 destination cards (existing DestinationCard) from the curated popular constant; "The classic lists" — 3 list links.
- Footer + nav from Phase 1. Metadata: real title/description; og default image.
- `/` must server-render its full content (no "Loading…" shell): fetch server-side.

### Task 12: Features page
Files: new `(public)/features/page.tsx`.
Requirements: Strava `/features` recipe at Peaks scale — 4 sections, 112px rhythm, flat image+heading+sentence blocks, sticky section mini-nav optional (only if trivial), sections: The catalog (58k peaks, areas, lists) / Planning (map, routes, plans) / Tracking (sessions, playback, stats) / Reports & photos. Each section may embed one live element (e.g. a real StatCluster or a real DestinationCard) instead of screenshots where no asset exists. CTA band at the end (accent-filled primary, one per page). Server-rendered, real metadata.

### Task 13: Destination detail re-skin (flagship)
Files: `(public)/destinations/[id]/page.tsx` (+ extract section components into `web/src/components/destination/`), reuse primitives.
Requirements — follow AllTrails trail-page anatomy (audit `2026-08-19-alltrails.md` §5) with iOS ordering rules:
- Order: breadcrumb › H1 (display) › meta row (type · elevation rank context if available · region, inline alert style reserved) › hero mosaic › topline StatClusters (elevation, prominence, ascents, high-point etc., scale=topline) › personal activity (signed-in) › About prose with source credit › planning (weather link, facilities, directions) › seasonality (existing month bars restyled to tokens: fill hairline, active accent) › map section (16px radius container) › routes › reports › nearby › lists.
- Hero mosaic: 2-tile (hero photo + map tile) or 3-tile when 2+ photos; 8px seams, 16px radius wrapper, map as a tile (Leaflet static-ish embed fine); photo credit muted overlay. No photo → map full-width tile with elevation stat overlaid.
- Sidebar dies; single column + right rail only ≥lg for "Top sights"-style nearby list (48px round thumbs where images exist).
- No boxed stats anywhere; sections by whitespace; sentence-case headings 20px/500 with optional eyebrow.
- Map: `detectRetina: true`, container bg `--color-fill`, attribution styled small.
- Keep every existing data element (audit praised completeness) — this is presentation surgery, not content removal.

### Task 14: Route, area, lists, report re-skins
Files: `(public)/routes/[id]/page.tsx`, `(public)/areas/[id]/*`, new `(public)/areas/page.tsx` (index: search + designation filter + state grouping, DestinationCard-like AreaCards), `(public)/lists/*`, `(public)/reports/[id]/page.tsx`; add "Areas" to nav (Task 9 put the link; page lands here).
Requirements: apply Task 13's patterns. Route page keeps canvas elevation profile but restyles it: tokens (ink area at 15%, accent-text line), container resize listener, dark-mode aware (pass resolved colors in). Report reader: real title as h1, author line (name + date), photos via `next/image` with width/height + rounded 16px + lazy; body typography (prose measure, 17px/1.7). Lists: cover strip (first destination hero image if any), progress bar (signed-in) using tokens; list rows with elevation in Geist Mono.

### Task 15: Discover re-skin + decompose
Files: `(public)/discover/page.tsx` → split into `web/src/components/discover/` sections (search, catalog stats, popular, routes, lists, reports).
Requirements: page becomes "Discover" catalog home: search bar (48px, fill background, pill, visible focus), quick chips, then sections with SectionHeading + card grids (one grid rhythm: 3-col xl, 2-col md). Unboxed stat row for catalog counts (server-rendered so no 0-flash). Kill the boxed rail. Reduce the 930-line monolith: each section its own component with its own data hook; page composes. No new features.

## Phase 3 — surfaces

### Task 16: Map explorer — defects + restyle
Files: `(public)/map/page.tsx`, `web/src/components/explore-map.tsx`.
Requirements:
- Defects (codebase sweep §7): read `q` from `useSearchParams` and run the search on load; fix the full-viewport `pointer-events-auto` overlay (only panels interactive); dedupe the route-drawing code paths; add zoom controls; hide result caps from labels; popups built via DOM `textContent` (kills the XSS — no HTML string interpolation).
- Restyle: AllTrails explore pattern — full-bleed map; floating left panel (400px, 24px inset, 16px radius, page background, internal scroll) with real result cards (name, elevation in Geist Mono, type, distance from viewport center); filter chips floating top; control cluster right (zoom, locate, layers) as 44px circles with shadow-float; `detectRetina: true`; container bg `--color-fill`; default view = geolocate with graceful fallback to a scenic default (Cascades: 47.5,-121.5, z9); sidebar results deduped by name+distance and typed (summit chip etc.); waterfalls behind a type filter defaulting to peaks+routes.
- Map view state (center/zoom/type toggles) in the URL query, replaceState on move.

### Task 17: Session detail + log + account re-skin
Files: `(public)/log/[id]/page.tsx`, `(authenticated)/log/page.tsx`, `session-card.tsx`, `elevation-profile.tsx`, `session-playback.tsx` styling, `stats-banner.tsx`, `(authenticated)/account/*`.
Requirements — Strava activity anatomy (audit `2026-08-19-strava-signed-in.md` §2b, §5) in Peaks tokens:
- Session page order: title block (activity icon, timestamp+place meta line, display H1) › topline 4 StatClusters (28px scale: distance, gain, time, high point) › secondary 2×3 grid (12px labels, mono values: pace, descent, calories/energy if present) › achievements line ("Reached Camp Muir" style, one line per destination reached, small trophy glyph + accent-text link) › map + elevation chart (synchronized playback kept) › splits-like table if data supports › areas/destinations/routes chips › owner actions (edit/share/export/delete as quiet buttons, one primary max).
- Chart: ink 15% elevation area, single accent-text metric line, hairline grid, mono axis labels, metric pill toggles below (elevation/speed/heart rate as available), dark-mode aware.
- Log list: lifetime StatClusters at top (page scale), filter chips, session cards restyled (map thumb 16px radius when available, title 17/500, mono stat row).
- Account: single tidy page — avatar, name, email, links row, sign out quiet; friends page conformance.

### Task 18: SEO landing pages
Files: new `(public)/activities/[type]/page.tsx` (hiking, peak-bagging, skiing, trail-running), new `(public)/peaks/[state]/page.tsx` (US states with catalog presence), additions to sitemap.
Requirements: Strava `/sports/*` recipe (audit strava-public §7.10): server-rendered; hero (contour component from Task 11, variant), display H1 ("Peak-bagging with Peaks", "The peaks of Washington"), one-paragraph positioning, live content: top-12 destinations by ascent count for the state/type as cards, protected areas row, classic lists row, CTA band (app + browse). `generateStaticParams` for states with >50 destinations; metadata + JSON-LD ItemList. These pages must be real content, not thin shells: include a short editorial paragraph per state generated from catalog facts (highest peak, count, notable areas — computed from data, honestly phrased).

## Phase 4 — product surfacing

### Task 19: Trip-report photo upload + avatar flow fix
Files: `web/src/components/block-editor.tsx`, `web/src/lib/storage.ts`, `web/src/lib/actions/profile.ts` + `users.ts`.
Requirements: real file upload in BlockEditor (client: validate MIME image/jpeg|png|webp|heic, ≤10MB, downscale to ≤2048px via canvas before upload; upload to the existing Firebase Storage pattern; progress state; error line). Enforce the same limits on avatar upload (the copy already promises it). Fix the avatar/profile field mismatch: `getUser` reads both `avatar` and `avatarUrl`, and handles string `name` as well as `name.first/last` (codebase sweep §7).

### Task 20: Weather on destination pages
Files: `web/src/lib/actions/weather.ts` (new), destination page section.
Requirements: server action reading the existing public Firestore `weather` collection (see `firebase/firestore.rules` and `functions/src/destinationHelpers.ts` for the shape — investigate first; if the collection is per-destination cached forecasts, read it; if empty/stale in practice, fall back to calling the deployed `getDestinationWeather` callable via Firebase Admin). Render: compact strip under planning — today + 3 days, temp hi/lo (mono), precip glyph, wind — unboxed row of small tiles (fill background 6px radius, the AllTrails weather-tile pattern). Feature-flag by data presence: no data → no section. NOAA link stays as "Full forecast".

### Task 21: Plan detail parity + reliability
Files: `(authenticated)/plans/[id]/page.tsx`, `web/src/lib/actions/plans.ts`, pickers.
Requirements (codebase sweep §5/§7): surface the SQL-processed plan data the API already returns — total distance/gain (mono StatClusters), full multi-route map (all route polylines + plan geometry), auto-matched reached destinations list. Replace `console.error`-only failures with visible error lines + retry; `finally` clears loading. Pickers show real names for existing selections (pass loaded names; add initial-name prop to RoutePicker). Filter route picker to `active` routes for non-admin use. Batch the N-per-record loads into one action.

### Task 22: Route history on sessions + routes (efforts-lite)
Files: session page section, route page section, `web/src/lib/actions/` addition.
Requirements: using existing data only (`session_routes` coverage + `session_attempt_groups`): on a session with a matched route, show "Your history on this route": count + list of the user's prior sessions on it (date, time, mono) + fastest marked "PB". On route pages (signed-in): "You've done this route N times · Best: 4h 12m". Rank presented Strava-style as participation ("1 of your 4 attempts") — never bare ranks. No schema changes; if the queries can't be done read-only from existing tables/actions, reduce scope to what can and note it in the report.

---

## Final
Whole-branch review (most capable model), fix wave, visual pass, then `superpowers:finishing-a-development-branch` (push branch, PR to main — do not merge).
