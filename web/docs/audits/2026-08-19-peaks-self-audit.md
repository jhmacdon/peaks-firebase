# Peaks Website Self-Audit — getpeaks.app

Audited 2026-08-19, signed out, 1280×720, DPR 2, dark system theme. DOM inspection, computed styles, raw HTML, HTTP probes.

**One-line diagnosis:** not a badly designed website — an undesigned one. A Next.js starter template pointed at an excellent database, with the marketing locked behind the login page and the product it's meant to sell (the iOS app) never mentioned.

## 1. Route inventory

| Path | Status | Notes |
|---|---|---|
| `/` | 307 → `/discover` | No landing page exists |
| `/discover` | 200 | De-facto homepage |
| `/map` | 200 | Full-screen explorer. Disallowed in robots.txt |
| `/lists`, `/lists/{id}` | 200 | 17 lists; detail title missing `| Peaks` suffix |
| `/destinations/{hex}` | 200 | 58,121 pages |
| `/areas/padus-{hash}` | 200 | 3,869 pages. NOT linked from any nav; `/areas` index 404s |
| `/routes/{id}` | 200 | 257 pages |
| `/reports/{id}` | 200 | 17 total; newest Aug 2022 |
| `/login`, `/register` | 200 | Carry the site's only real marketing copy |
| `/account` `/plans` `/log` | client-redirect | gate is client-side only |
| `/admin` | 200 → `/admin/login` | publicly reachable on main domain |
| `/sitemap.xml` | 200 | 7.6 MB, 62,283 URLs in ONE file (over Google's 50k cap) |
| `/opengraph-image` | 200 | valid 1200×630 PNG that nothing references |
| `/about /privacy /terms /download /pricing /support /blog /explore /areas /search /profile …` | **404** | none exist |

## 2. Worst findings by page

### `/discover`
- `document.images.length === 0` — zero images on the homepage of an outdoor product.
- No mention of iOS/App Store anywhere; zero external links; no way to get the app.
- Hero: "Search like a trail planner, not a landing page." — meta-copy that never says what Peaks is.
- "Popular searches" / "Popular destinations" are database slices: obscure Polish hills one load, six alphabetical "Lower * Lake" rows the next; #1 "most recorded" destination has 0 routes/0 reports/0 sessions.
- Catalog counts flash `0` pre-hydration; count unstable (56,752 vs 58,121 across loads); two contradictory route counts on one screen (257 vs 6).
- "Recent trip reports": newest Aug 27, 2022.
- Bordered rail wrapping four bordered stat cards — breaks "no box inside a box" AND "never box a stat".
- Three grid rhythms on one page; "Sign In" appears twice in the header; no focus ring on search (outline:none, no replacement); list cards print raw peakbagger URLs as body copy; route cards read "Unknown shape"; permission-failure text shipped as card copy.

### `/destinations/{id}`
- Meta description is a data dump: `"point PL 1,823 ft"` — the Google snippet for 58k pages; reused as og/twitter description.
- `Region: PL`, `Type: Point` — raw enums. Templated About copy contradicts on-page data ("Most of the activity recorded here is hiking" on a 0-session page).
- Elevation printed 3×, prominence 2×, coordinates 2× (raw decimals with a Copy button as a content row).
- Leaflet + OpenTopoMap 256px non-retina tiles — blurry at DPR 2; default controls, default `#ddd` background, volunteer tile server. All 12 images are map tiles.
- ALL-CAPS sidebar headings vs sentence-case main headings. No JSON-LD.

### `/routes/{id}`
- "Unknown shape" ×4 including mid-sentence. `Elevation loss: 0 ft` on Camp Muir (gains 4,677 ft). Camp Muir rated "Moderate"; 5 of 6 featured routes "Moderate".
- "Est. time 3h 27m – 4h 52m" false precision. Three names for one number (logs / recorded sessions / Sessions). `Waypoint 2` labels. Invented jargon ("Climbing density 1,155 ft/mi"). Meta description: `"4.1 mi 4,677 ft 3 destinations 43 sessions"`.

### `/areas/padus-{hash}`
- `padus-` dataset acronym in all URLs. Four consecutive raw-code rows: `Designation: WA · Manager: NPS · Region: VA · Source: USGS PAD-US 4.1`. Orphaned from nav (3,869 pages, no index). Map caption paragraph explains the legend. Only place teal appears on the whole site.

### `/lists`
- Literal `\n\n` rendered as visible text (Seven Summits). 10 of 17 share byte-identical boilerplate. 5 print unlinked peakbagger URLs. California Fourteeners almost-sorted (worse than unsorted). "Kosiuszko" typo. "Ultras Of Iran". Zero images.

### `/reports/{id}`
- Every h1 is literally "Trip Report"; every title `Trip Report | Peaks`. Author is "Peaks member" — no identity on the inherently social page type.
- Photos: raw unoptimized Firebase Storage JPEGs, no width/height/srcset/lazy, 718px layout shift; not next/image. og:image leaks internal bucket `donner-a8608` + storage token.
- Breadcrumb separator `/` here vs `›` elsewhere; two date formats.

### `/map`
- No zoom controls at all (detail maps have them). Default `#ddd` container on a black page. Result caps leak as labels ("Peaks · 200"). Sidebar is an elevation-sorted dump — waterfalls dominate the default view; duplicate names. Default view = zoom 5 northeast US. Hero's primary CTA and robots-blocked simultaneously. Unfiltered GNIS toponyms incl. at least one known slur variant (separate task spawned).

### `/login`, `/register`
- Best copy on the site lives here ("Built for serious mountain progress", Map-first planning / Trip reports / Progress tracking).
- No header on either page. All five inputs have no id/name/label/autocomplete. OAuth buttons are `type="submit"` inside the email form (Enter fires Google OAuth). No terms/privacy links on account creation (and none exist on the domain). Password min 6 (Firebase default).

### Site-wide
- Every page server-renders ~150–173 chars: nav + "Loading…" — all 62,283 URLs. Titles/meta server-rendered; content not.
- No footer element anywhere. No og:image anywhere (while declaring `summary_large_image`); og:title of homepage is "Discover". No apple-touch-icon; manifest icon is favicon.ico only. Three conflicting dark theme colors (`#0a0a0a` body, `#030712` shells, `#0f172a` manifest). Two loading strings (`Loading…` vs `Loading...`). No JSON-LD. Console clean; TTFB 0.24–0.82s — performance is not the problem.

## 3. Measured tokens

Type: Geist via next/font; Geist Mono bundled, never used. h1 treatments: 36/700 (discover), 30/700 (destination), 30/600 (lists), 24/600 (list detail/report). Stats: 18px/600 proportional (iOS spec wants large rounded monospaced).

Colors: body `#0a0a0a`/`#ededed` (create-next-app defaults), shells `#030712` (gray-950), cards `#101828` (gray-900), borders `#1e2939`/`#364153`, muted `#99a1af`, **accent `#155dfc` (Tailwind blue-600)**, map `#dddddd` (Leaflet default). Four near-blacks in play.

**Decisive measurement: 205 CSS custom properties; 202 are stock Tailwind v4.2.1 defaults; 3 custom (`--spacing`, `--background`, `--foreground` — the latter two verbatim create-next-app).**

Layout: max-w-7xl (discover/lists) vs 6xl (details) vs 3xl (reports); radius 6/8/12/9999; **shadow: none site-wide**; dark-mode media-only, no toggle; mobile hides the wordmark and Create Account CTA entirely (`hidden md:block` header + bottom tab bar).

## 4. The 15 worst offenders (ranked)

1. No marketing site — `/` 307s into a database browser.
2. No mention of iOS/App Store; zero external links.
3. Zero photography site-wide.
4. "Popular" content is a random database slice.
5. The whole site is a create-next-app skin (202/205 stock vars).
6. Every page ships "Loading…" to 62,283 URLs.
7. Meta descriptions are data dumps on ~62k pages.
8. No og:image anywhere (valid one exists, unreferenced).
9. Null values shipped as copy (Unknown shape, Designation: WA, `\n\n`).
10. Visibly wrong data presented confidently (0 ft loss, Moderate Camp Muir, broken sort).
11. Maps look homemade (blurry tiles, defaults everywhere, no zoom controls on /map).
12. "Recent" content is four years old; authors are anonymous.
13. No footer, privacy, or terms — including on account creation.
14. Nothing is consistent between page types (4 h1s, 3 widths, 2 separators, 2 loading strings, 2 title templates).
15. Broken form/focus semantics.

Runners-up: double Sign In; orphaned areas; 7.6MB sitemap; boxed stats in a box; public /admin; donner-a8608 bucket + token in og:image; unfiltered toponyms.

## 5. Worth keeping

- Login/register copy (move it to the homepage).
- The data moat: 58,121 destinations, 3,869 areas with boundaries, 257 routes, curated lists.
- The canvas elevation profile (correct 2× backing, crosshair scrub) — the one designed component.
- Detail-page information order — already matches the iOS design system.
- Performance and technical hygiene (proper 404s, canonicals, attribution).
- Geist is defensible; Geist Mono is bundled and ready for numerals.
