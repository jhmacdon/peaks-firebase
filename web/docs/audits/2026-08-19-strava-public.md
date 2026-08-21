# Strava Public Web Audit — Design System & UX Reference

Measured from the live DOM via getComputedStyle at 1280×720, 2026-08-19, signed out. Pages: `/`, `/features`, `/maps`, `/challenges`, `/subscribe`, `/login`, `/segments/229781`, `/clubs/strava`, `/athletes/…` (404), `/sports/running`, `/routes`, `stories.strava.com`.

## 0. The single most important finding

Strava runs **three coexisting design generations** on one domain. Copy the newest, ignore the rest.

| Gen | Where | Tell |
|---|---|---|
| **A — current marketing** | `/features`, `/subscribe`, `/sports/*` | `BoathouseExtended` display type, warm greys (`#43423F`), 128px section rhythm, Contentful-driven |
| **B — current app** | `/`, `/login`, `/maps`, `/clubs` | `Boathouse`, 4px radius, warm greys, CSS-module Next.js |
| **C — legacy** | `/challenges`, old footer | Cool/bluish greys (`#494950`, `#DFDFE8`, `#B2AFC0`), link blue `#007FB6`, 6px radius cards |

## 1. Typography

Proprietary superfamily **"Boathouse"**: `Boathouse` (UI/body), `BoathouseExtended` (display headings only, 48px+), `BoathouseCondensed` (loaded, unused). Weights 300–900. `Noto Sans` variants for international scripts only.

Stack: `Boathouse, "Segoe UI", "Helvetica Neue", -apple-system, system-ui, Roboto, Arial, sans-serif`.

**A custom width-axis family with the wider cut reserved exclusively for display is the premium signal.** Peaks needs one distinctive display face used only at display sizes.

### Type scale (measured)

| Role | Size / LH | Weight | Family |
|---|---|---|---|
| Display XL (sport h1) | 80 / 88 | 600 | Extended (white on dark, max-width 700px) |
| Display L (features h1) | 72 / 72 | 600 | Extended |
| Gate-wall h1 | 72 | 500 | Boathouse |
| Section h2 | 60 / 72 | 600 | Extended |
| Sub-section h2 | 48 / 56 | 600 | Extended |
| Editorial h1 | 52 / 57.2 | 500 | Boathouse |
| Section h2 (small) | 32 / 41.6 | 600 | Boathouse |
| Card/feature title | 22 / 28 | 600 | Boathouse |
| h4 | 20 / 26 | 400–600 | Boathouse |
| Grid card title | 16 / 20.8 | 600 | Boathouse |
| Nav link | 16 / 20.8 | 400 | Boathouse |
| Body | 15 / 20 | 400 | Boathouse (editorial base is 18px) |
| UI default / footer link | 14 / 18 | 400 | Boathouse |
| Eyebrow | 13 / 16 | 700 | uppercase |
| Legal | 12 / 16–18 | 400 | Boathouse |

**Line-height tightens as size grows**: 1.00–1.10 display → 1.20–1.30 section → 1.29–1.40 body. **Letter-spacing only on uppercase**: 0.08–0.16em scaled by purpose; lowercase gets ~0.01em or nothing.

## 2. Color

**Accent `#FC5200`** — one orange, no tints/shades/gradients/second accent. Used on: primary filled CTAs, outline CTA text+border, NEW badge, logo, inline nav links. **Never on**: headings, body, section backgrounds, hover, data/stats. Legal links use blue `#0060D0` so consent copy can't compete with the CTA. ~2–4 orange instances per viewport; 4 orange buttons on the whole 8,208px `/features` page.

Warm grey ramp (R > G > B throughout):

| Hex | Role |
|---|---|
| `#000000` | display headings, table body |
| `#21211F` | primary text; dark card fill |
| `#353633` | dark footer |
| `#43423F` | secondary text |
| `#64635E` | muted, social-button border |
| `#918E89` | form input border |
| `#E0E0DE` | button/control border |
| `#F2F2F0` | hairlines, light fill |
| `#FAFAFA` | off-white button fill |
| `#F9F8F5` | warm off-white footer |

Legacy palette (do NOT copy): `#494950`, `#242428`, `#DFDFE8`, `#B2AFC0`, `#007FB6`.

## 3. Layout

- Outer cap **1728px**; inner grid **1248px** (16px padding → 1216 usable); card grid 4×292.75 + 15px gap; club page 932 + 300 sidebar; hero text 811px; form column 343–404px; comparison table deliberately 544px.
- **128px top/bottom marketing section rhythm**; 64–72px lighter sections; dark footer 83/116. **Whitespace only — zero dividers between sections.**
- Nav heights: marketing fixed 64px (`rgba(255,255,255,.98)`, z 900, shadow `0 13px 26px rgba(0,0,0,.09)`), landing 74px, app 57px (`1px #F2F2F0` + `0 1px 2px rgba(0,0,0,.03)`). Nav items get 73px hit targets via `26px 20px` padding.
- Current footer: four ungrouped columns, no headings, `#F9F8F5`, 64px padding, links 14px/400 `#43423F`. (Product / Money / Company / Legal.)

## 4. Components

**Buttons** — current radius 4px (newest pricing page 16px; pick one).
- Primary: `#FC5200` fill, white text, 2px border matching fill; 64px marketing / 48px in-page / 40px nav; font 600.
- Secondary: transparent, `1px solid #FC5200`, orange text, 44px.
- Neutral/OAuth: `#FAFAFA`, `1px solid #64635E`, 44px.
- Quiet: white, `1px solid #E0E0DE`, 40px.
- Exactly three ranks + one quiet variant. No sprawl.

**Cards: marketing pages have none.** Feature blocks are flat image + heading + paragraph. Cards only for browsable lists: 293px, 6px radius, `0 2px 6px rgba(0,0,0,.08)`. Pricing cards 395×508, radius 4, `0 8px 24px rgba(13,13,18,.04)`, alternating dark `#21211F`/light `#F2F2F0` fills to rank plans. Max shadow opacity 0.09.

**Badges**: NEW = orange fill, radius 4, 17px/700 uppercase. Discount = `#64635E`/black fill, 12px/600.

**Stats**: price 60px at weight 500 with 88px LH. No stat boxes anywhere. Club count inline (`7,230,017 members`, 22px/400).

**Comparison table**: 544px, th 17px/700 uppercase ls 1.7px, td 22px/400, 64px rows, no rules, no fills, no zebra.

**Forms**: inputs 344×47, `1px solid #918E89`, radius 4, 16px font (prevents iOS zoom). SSO first, email second. Legal at 12px with blue links.

## 5. Imagery

- Full-bleed heroes with **no scrim** — photography art-directed dark enough for white text. `/features` hero 798px, bottom-anchored background.
- 16:9 editorial images, flat, radius 0. Circular entity avatars at 160px for clubs/athletes. Club cover 1248×400 with 124px overlapping avatar (radius 4).
- WebP @1x/@2x from a CDN, per-locale filenames — imagery is localized.
- `/maps`: full-bleed canvas app; every toggle in the URL (`?sport&style&terrain&labels&poi&3d`). `/routes` 301s into `/maps`.

## 6. Voice

Short declaratives, 4–8 words, sentence case, often with a period. Signature moves:
1. Two-beat headlines split by a period ("The best of Strava. Built for your goals.")
2. Verb-first CTAs mirroring the section (Train → "Start training").
3. Oddly-specific numbers as proof ("Every 19 seconds, a Subscriber hits their goal.")
4. Self-aware repetition ("And by everything, we mean everything").
5. Second person, present tense, active voice; one-sentence feature bodies (12–20 words).
6. Product features capitalized as proper nouns (Routes, Segments, Local Legend).
7. 404 with personality plus five useful next steps.
8. Trial-anxiety-reduction timeline: Today / 2 days before / In 30 days.

## 7. UX patterns

1. **Stacked sticky nav**: 64px fixed global + 78px section nav stuck at top:64, giving long pages a persistent TOC.
2. **Scroll sentinels**: zero-height divs + IntersectionObserver flip nav state — no scroll math.
3. Nav color inversion over dark heroes via light/dark classes.
4. **Hover is nearly invisible** — verified: hovering primary/outline buttons changes no computed property. Underline on text links only. Premium = stillness.
5. Mega menu: 236px, white, `1px #F2F2F0`, `0 20px 20px rgba(13,13,18,.1)`, toggled via visibility (transitionable).
6. Separate mobile/desktop component trees (`display:none` swap) — each breakpoint gets real composition.
7. **Signed-out homepage is a signup form, not a brochure**: 968px total, photo | signup card | photo. Marketing lives on `/features` and `/sports/*`.
8. **Layered gating**: segments = hard wall naming the entity ("Log in to see "Hawk Hill"", noindex); clubs = real content then inline stub at curiosity peak; sport pages fully open with real named clubs/athletes.
9. Sticky bottom conversion banner on public entity pages: `rgba(43,43,43,0.9)`, 92px, doesn't block content.
10. **`/sports/running` is the template to clone** for activity-type SEO landers: dark hero, 80px h1 capped at 700px, 3-up feature grid, live challenge cards, real entities as 160px circular tiles, device section.

## Top 10 for a small competitor

1. One distinctive display typeface reserved for display sizes only — the highest-leverage purchase available.
2. Ration the accent to 2–4 per viewport; never on headings; separate blue for legal links.
3. Warm greys (copy the ramp shape: `#21211F → #43423F → #64635E → #E0E0DE → #F2F2F0 → #F9F8F5`).
4. The 128 / 1248 / 16 rhythm; whitespace only, no dividers.
5. Delete cards from marketing pages; reserve them for browsable lists.
6. Stacked sticky nav with scroll sentinels.
7. Activity-type SEO landers on the `/sports/running` recipe.
8. Gate in layers; name the entity in the wall.
9. Signup-card homepage (once the brand is known); pitch lives on /features.
10. Kill hover effects — stillness reads as tool, not template.

Bonus: map view-state in the URL; localized image filenames; a 404 with a joke and five real options.
