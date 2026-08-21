# AllTrails Design Audit — for the Peaks redesign

Measured from the live DOM via getComputedStyle + getBoundingClientRect at 1280×720, 2026-08-19, signed out. Pages: landing, `/explore`, two trail pages (Mount Si, Rattlesnake Ledge — template-identical within 8px), a park page (Mount Rainier NP), a city page (North Bend), footer/site map.

## 1. Typography

One family, **two weights only** — `AllTrailsAeonik, Arial, sans-serif` at **400 and 500**. Nothing is 600+ anywhere. All emphasis from size and colour, never weight.

| Role | Size | Weight | LH | Tracking | Colour |
|---|---|---|---|---|---|
| Display XL (hero h1) | 72 | 500 | 1.06 | −0.1 | #FFF |
| Display L (feature h2) | 56 | 500 | 1.10 | −0.1 | #161F13 |
| Page H1 (trail/park/city) | 45 | 500 | 1.15 | 0 | #161F13 |
| Section h2 | 32 | 500 | 1.20 | 0 | #161F13 |
| Subsection | 20 | 500 | 1.50 | +0.1 | #161F13 |
| Body / card title / button | 16 | 400–500 | 1.50 | +0.2 | #161F13 |
| Body prose | 16 | 400 | 1.70 | +0.2 | #161F13 |
| Small | 14 | 400–500 | 1.50 | +0.2 | — |
| Meta (all stats/labels) | 13 | 400 | 1.50 | +0.25 | #535B52 |

**The optical ladder:** line-height flat 1.5 for everything ≤20px, tightening as size grows (1.2 → 1.15 → 1.1 → 1.06). Tracking positive and increasing as text shrinks (+0.25 @13 → −0.1 @56+). Only two body sizes do all the work: 16 and 13.

## 2. Colour

| Token | Hex | Usage |
|---|---|---|
| Ink | `#161F13` | primary text, footer bg, dark buttons — near-black with a green cast |
| Muted | `#535B52` | secondary text; used MORE than ink (108 vs 66 nodes on a trail page) |
| Muted alt | `#6B746A` | disabled/tertiary |
| Surface | `#FFFFFF` | page/panels |
| Surface 2 | `#F4F5F4` | inset tiles, banding |
| Surface 3 | `#E6EAE6` | sage bands on landing |
| Hairline/fill | `rgba(17,23,14,0.10)` | 1px borders AND search-field fill |
| Hairline strong | `rgba(17,23,14,0.18)` | 2px borders |
| Accent lime | `#94F477` | PRIMARY CTA FILL ONLY, 1–3× per page |
| Dark chrome | `#0E110E` | floating action bar |
| Alert | `#BA4C21` | danger/closures, inline text |

Accent rules: lime only as a filled pill (Save / Get the app). Never text, border, icon tint, or large area. **Difficulty is not colour-coded** (plain muted text). **Stars are monochrome ink**, not gold. **Links carry underline, not colour.**

Radius: 16px containers/images, 9999px buttons/chips/avatars, 8px small thumbs, 10px map filter chips.

Shadows — three, only for floating things: `0 2px 4px rgba(0,0,0,.14), 0 0 1px rgba(0,0,0,.3)` (sticky bar), `0 4px 8px …18` (map controls), `0 8px 12px …15` (floating CTA bar). **Content cards carry no shadow, border, or background at all.**

## 3. Layout

- Header 64px, white, no border/shadow. Container `max-width: 1120px`; 6 cols × 166.664 + 24px gutters.
- Hero mosaic: same 6 cols at 180px with **8px** gap, radius 16 + overflow hidden on the wrapper — one rounded slab with hairline seams; includes the MAP as a tile.
- Trail page: H1 spans cols 1–5; prose 619px; right rail 357px at x=843. Park page: 48px section gap, 536px text column.
- Section rhythm: 32px headings with 36px margin-bottom; sections separated by whitespace only.
- **Explore is not a split**: full-bleed 1280×656 map, non-scrolling page. Sidebar panel 400px, 24px inset, white, radius 16, no shadow, virtualised internal scroll. Filter chips float at x=440, y=88. Map control rail: 48px circles at 56px pitch, x=1208. Everything on a 24px inset.
- Sticky: 64px tab sub-nav (Overview / Conditions / Reviews / Nearby), a slide-in fixed bar, and the floating CTA pill.

## 4. Components

**Trail card — one component everywhere** (landing 298px, explore 352px, nearby 363px): image ratio 1.21 (~6:5), 16px radius, **no card chrome** — title 16/500 +12px below image, subtitle 13/400 muted, meta row +17px: `★ 4.7 · Moderate · 5.6 mi · Est. 3–3.5 hr` all 13px muted with middle dots.

**Stat row**: flex gap 36px; value 16/500 ink over label 13/400 muted. No box/divider/icon. (Small numerals — an anti-pattern for Peaks; keep big mono numerals.)

**Buttons** — all radius 9999, 2px transparent border reserved for focus: Primary 48px `#94F477`/ink; Dark 36px ink/white; Neutral 48px white/ink; On-dark secondary `rgba(244,245,243,.14)`; Ghost-on-photo 2px `rgba(244,245,243,.4)` border.

**Floating CTA bar**: 484×72, radius 9999, `#0E110E`, one lime primary (Save) + two translucent secondaries (Get directions, Send to phone).

**Search field**: 48px, radius 9999, fill `rgba(17,23,14,0.10)`, no border.

**POI "Top sights" row**: 48px circular photo thumb + name 16px + type label ("Peak", "Waterfall"). Unboxed.

**Ranked park row**: 180×180 image radius 8, rank+name 20/500 (`#1 - Skyline Loop`), meta 16/400, 14px editorial description. Unboxed.

**Alert**: inline text, not a banner — `Danger · Sunrise & White River Area CLOSED…` at 13px `#BA4C21` inside the meta row.

Photos/reviews gated behind sign-up modal; public page substitutes an AI review summary ("Trailgoers are saying", labelled AI-generated).

## 5. Trail detail anatomy (Mount Si, exact y at 1280w)

| y | Section |
|---|---|
| 0 | Header 64px |
| 64 | Breadcrumb 72px (`Back to Explore` + Country/Region/Park/Trail) |
| 136 | H1 45/500 |
| 200 | Meta row 13px: `[alert] · ★4.7 (20,574 reviews) · Hard · Park` — links underlined |
| ~250 | Sticky tabs |
| 331 | Hero mosaic 1120×372: photo 744×372 + photo 368×182 + MAP 368×182; ghost `N photos` pill; floating dark CTA bar at y≈624 |
| 743 | Stat row (Length / Elevation gain / Route type) + right rail `Top sights` |
| ~800 | Description prose, `more` expander |
| 1078 | "Trailgoers are saying" AI summary + `Show all reviews` |
| 1522 | `Plan your visit` · `Visitation` teaser |
| 2111 | App promo band |
| 2308 | Conditions (weather tiles 80×44, radius 16, `#F4F5F4`) |
| 3071 | Top trails nearby carousel |
| 3692 | FAQ accordion (questions 16/400, deliberately not bold) |
| ~4400 | Last-updated timestamp |
| 4461 | `Explore near X` — 4 link columns |
| 4998 | Footer `#161F13` |

Ordering principle: identity → credibility → imagery → hard numbers → prose → social proof → planning → related → SEO. **Photos before stats; the map treated as a photo.**

Park page extras worth stealing: rank line in meta (`United States: #3 of 59 national parks`), `Top sights` POI rows, ranked `#1…#10` trail rows with editorial descriptions.

## 6. Explore map UX

Full-bleed map + floating 400px panel (24px inset, radius 16, no shadow). Panel header: `Explore trails` 20/500, count 13px left, sort 13px right. Filters float OVER the map (36px white chips, radius 10). Map controls: 48px white circles, 56px pitch (3D, zoom ±, locate) + `Build custom route` pinned + a 152×88 `Map layers` preview card showing the target basemap thumbnail. Pins are WebGL symbol layers in-canvas (no DOM markers) — what keeps thousands smooth. Result cards link to `/explore/trail/...` to keep map context.

## 7. Voice

Trail descriptions follow a five-beat template: why it's popular → parking/permits early → honest difficulty calibration → options at the destination → seasonal warning. Second person, plain, practical, willing to say don't. Conventions: `Easy/Moderate/Hard/Strenuous` plain words; `Est. 3–3.5 hr` always a range; middle-dot separators; section titles are plain nouns. Gated-data teasers state the user benefit ("Beat the crowds with weekly and monthly trail activity data").

Public directory hierarchy: `/directory/{countries,regions,cities,parks,trails,poi,trail-features}` — clean model for the Peaks place taxonomy.

## Top 10 for Peaks

1. Two weights, never bold.
2. The optical tracking ladder (adopt the curve wholesale).
3. Underline for links, not colour — frees the teal.
4. Accent = one filled primary, 1–3× per page.
5. Cards with no card (image + flat text; "no box inside a box" at its purest).
6. The hero mosaic including the map as a tile.
7. Elevation only for things that float.
8. The floating dark action pill (Save + Directions + Send to phone).
9. Alerts as inline coloured text, not banners.
10. `Top sights` typed POI rows + rank lines — catalog facts presented as a guidebook.

**Reject:** 16px stat numerals (Peaks keeps large monospaced numerals) and sign-up-gating catalog content.
