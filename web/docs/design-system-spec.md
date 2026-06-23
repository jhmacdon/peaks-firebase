# Peaks web — site-wide design system spec

The destination and route detail pages set the visual standard for the whole
app: flat editorial surfaces, gray hairline structure, capped radii, and color
used sparingly as small **outlined pills**. This spec distills that language
into reusable rules and applies it to the rest of the site so the two competing
aesthetics (clean detail pages vs. glossy gradient cards/home) collapse into
one.

This is the generalization of [`destination-page-spec.md`](./destination-page-spec.md).
That document remains the canonical reference for the detail-page *layout*; this
document governs the *visual system* shared across every user-facing surface.

> Spec location note: kept in `web/docs/` alongside `destination-page-spec.md`
> (project convention) rather than the brainstorming default
> `docs/superpowers/specs/`.

## Design principles

- **Minimal gradients.** No `bg-gradient-*`, no `linear-gradient`, no
  `radial-gradient` glow overlays — on any user-facing surface. Backgrounds are
  flat fills.
- **Colorful outlines, not colorful fills.** Category color appears as small
  outlined pills (border + tinted text + faint fill), small type labels, and a
  card's leading icon — never as a gradient wash, a tinted card background, or a
  heavy colored border.
- **Borders are the structure.** Gray hairlines and `divide-y` rules replace
  cards-floating-on-shadows.
- **Restraint over decoration.** Capped radii, no decorative shadows, no hover
  lift, modest type scale.
- **Full dark mode.** Every token ships a `dark:` variant.

## Tokens & rules

### Surfaces
- Page background: `bg-white dark:bg-gray-950`.
- Card / panel background: `bg-white dark:bg-gray-900`.
- Subtle inset surface (e.g. ruled stat cells base): `bg-gray-50 dark:bg-gray-900`.
- Outer containers never carry gradients or colored backgrounds.

### Borders & dividers
- Default hairline: `border-gray-200 dark:border-gray-800`.
- Hover emphasis: `hover:border-gray-300 dark:hover:border-gray-700`.
- List rows inside a section: `divide-y divide-gray-200 dark:divide-gray-800`
  (no per-row card chrome).

### Radius
- Capped at `rounded-lg` for cards, panels, images, inputs, buttons use
  `rounded-md`.
- Genuinely pill-shaped chips may use `rounded-full`.
- **Banned:** `rounded-2xl`, `rounded-3xl`, and every arbitrary value
  (`rounded-[24px]`, `rounded-[26px]`, `rounded-[28px]`, `rounded-[32px]`).

### Shadows & motion
- No decorative shadows. **Banned:** `shadow-md`, `shadow-lg`, `shadow-xl`,
  `shadow-2xl`, and arbitrary `shadow-[…]`.
- No hover lift (`hover:-translate-y-*`) and no `transition-all`; transitions are
  limited to `transition-colors`.
- **Exception — floating overlays only:** dropdowns, popovers, the
  search-result menus in `destination-picker` / `route-picker`, the map's
  control panels, and modals may use a single functional `shadow-sm` (or
  `shadow-md` for modals) to lift off the content beneath. This is the only
  permitted shadow.

### Neutral palette
- Unify on Tailwind `gray`. **Retire `stone` and `slate`** everywhere in scope
  (replace `stone-*`/`slate-*` with the matching `gray-*`).

### Interactive color
- Primary action + links: `blue-600`, hover `blue-700`
  (`dark:text-blue-400`). This is independent of category color — blue always
  means "clickable / primary action."
- Primary button:
  `inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700`.
- Secondary button:
  `inline-flex items-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800`.

### Per-type accent palette
Category color is used only for outlined pills, type labels, and a card's
leading icon.

| Type | Accent | Outlined pill (light) | Outlined pill (dark) |
|------|--------|-----------------------|----------------------|
| Destination | emerald | `border-emerald-200 text-emerald-700 bg-emerald-50` | `dark:border-emerald-900/50 dark:text-emerald-300 dark:bg-emerald-950/40` |
| Route | sky | `border-sky-200 text-sky-700 bg-sky-50` | `dark:border-sky-900/50 dark:text-sky-300 dark:bg-sky-950/40` |
| List | amber | `border-amber-200 text-amber-700 bg-amber-50` | `dark:border-amber-900/50 dark:text-amber-300 dark:bg-amber-950/40` |
| Trip report | gray (neutral) | `border-gray-200 text-gray-600 bg-gray-50` | `dark:border-gray-700 dark:text-gray-300 dark:bg-gray-800/60` |

Every outlined pill also carries the shape classes:
`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium`.

### Difficulty pills (semantic)
Difficulty keeps its semantic ramp but **switches from filled to outlined** to
match the system:

| Label | Outlined classes |
|-------|------------------|
| Easy | `border-emerald-200 bg-emerald-50 text-emerald-700` / dark `border-emerald-900/50 bg-emerald-950/40 text-emerald-300` |
| Moderate | `border-sky-200 bg-sky-50 text-sky-700` / dark `…sky…` |
| Hard | `border-amber-200 bg-amber-50 text-amber-700` / dark `…amber…` |
| Strenuous | `border-red-200 bg-red-50 text-red-700` / dark `…red…` |

This is the one approved change to the canonical detail pages (updates
`DIFFICULTY_CLASSES` in `detail-sections.tsx`).

### Typography
Straight from the detail pages:
- h1: `text-3xl font-bold tracking-tight text-gray-900 dark:text-white`.
- Section h2: `text-xl font-semibold text-gray-900 dark:text-white`.
- Body prose: `text-[15px] leading-7 text-gray-700 dark:text-gray-300`.
- Meta line: `text-sm text-gray-600 dark:text-gray-400`, parts joined with `·`.
- Stat value `text-lg font-semibold`; stat label `text-xs text-gray-500`.
- Coordinates and other fixed-width data: mono font.

### Labels & eyebrows
- **Drop the decorative eyebrows** — the wide-tracked uppercase mini-labels
  (`text-[11px] font-semibold uppercase tracking-[0.18em]` /
  `tracking-[0.22em]`) used on the discover sections and the old cards. Sections
  use a plain `h2` instead.
- **Keep** the restrained sidebar panel header style
  (`text-xs font-semibold uppercase tracking-wide text-gray-600`) from
  `SidePanel` — it is canonical and is not an eyebrow.

## Shared primitives

New primitives live in `src/components/ui/`. Existing detail-page primitives
(`Breadcrumb`, `StatCell`, `StatRow`, `SidePanel`, `DifficultyPill`, `titleize`)
stay in `src/components/detail-sections.tsx` and are reused as-is (with the
difficulty-pill restyle above). Consumers import the `ui/` primitives directly
(`./ui/card`, `./ui/badge`, `./ui/empty-state`).

| Primitive | File | Contract |
|-----------|------|----------|
| `Card` | `ui/card.tsx` | Flat shell: `rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700`. No shadow, no lift. Renders as `<Link>` when `href` given, else `<div>`. Borders stay neutral in all states; color comes from children (icon, pills, type label). |
| `Badge` | `ui/badge.tsx` | Outlined pill. Props: `tone: "emerald" \| "sky" \| "amber" \| "gray" \| "red"` (default `gray`) and children. Applies the per-type / semantic outlined classes above. |
| `EmptyState` | `ui/empty-state.tsx` | Flat bordered box: `rounded-lg border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900`. Replaces the `rounded-3xl … shadow-sm` empty panels. |

> Not built: `PageHeader`, `SectionHeading`, and a `StatStrip` wrapper were
> scoped originally but proved unnecessary — the restyled pages kept their
> existing header/section markup and the inline `grid … gap-px` stat strips.
> Add them later only if a page actually needs them (YAGNI).

Buttons and `SearchBar` are styled per the tokens above (no dedicated Button
primitive required; reuse the two button class strings).

### Card content by type
Each card is a lean editorial card built on `Card` + `Badge`:
- **Destination** — leading emerald icon (or emerald type pill), name (link,
  `text-gray-900 hover:text-blue-700`), meta (`elevation · region`/`distance`),
  up to 3 feature pills (first emerald, rest gray), optional `Routes / Sessions`
  mini-stats.
- **Route** — sky type pill, name (link), difficulty pill + shape + stop count,
  `Distance / Gain / Beta` mini-stats.
- **List** — amber type pill (`Peaks curated` / `Community list`), name (link),
  description (clamped), destination count.
- **Trip report** — neutral type pill (`Field report`), title (link), author +
  date, clamped preview, destination/photo counts.

## Application map (in scope: everything users see)

### Rewrite on the new primitives (gradient offenders)
| File | Current violations | Action |
|------|--------------------|--------|
| `components/destination-card.tsx` | gradient×2, big radius, shadow, stone, eyebrows | Rebuild on `Card`+`Badge`; flat, emerald accent. |
| `components/route-card.tsx` | gradient×2, big radius, shadow, slate/stone, eyebrows | Rebuild on `Card`+`Badge`; sky accent. |
| `components/list-card.tsx` | gradient×2, big radius, shadow, stone, eyebrows | Rebuild on `Card`+`Badge`; amber accent. |
| `components/trip-report-card.tsx` | gradient×2, big radius, shadow, stone, eyebrow | Rebuild on `Card`+`Badge`; neutral accent. |
| `components/search-bar.tsx` | gradient glow, glass icon tile, big radius, shadow, stone | Single bordered input (`rounded-md border-gray-300`, blue focus ring) with a plain inline search icon; clear button stays. |

### Restyle page chrome in place
| File | Action |
|------|--------|
| `app/(public)/discover/page.tsx` | Replace gradient hero + dark side panel with a plain header (`PageHeader` + sub + `SearchBar`) and flat bordered panels; convert `CatalogStat` / `QuickBrowseCard` / best-match tiles / empty states to `Card` / `EmptyState`; drop eyebrows; `stone`→`gray`; emerald action links → `blue-600`. |
| `app/(public)/map/page.tsx` | Flatten map chrome: arbitrary/`2xl/3xl` radii → `rounded-lg`; drop eyebrows; control-panel/overlay shadows reduced to functional `shadow-sm` (allowed exception). Map component itself unchanged. |
| `app/login/page.tsx` | Drop gradient background + card shadow + big radius; flat bordered card; `blue-600` primary; drop eyebrow. |
| `app/register/page.tsx` | Same as login. |

### Verify-and-tidy (already largely clean; inherit new cards)
`app/(public)/lists/page.tsx`, `app/(public)/lists/[id]/page.tsx`,
`app/(public)/reports/[id]/page.tsx`,
`app/(public)/destinations/[id]/reports/page.tsx`,
`app/(authenticated)/log/page.tsx`, `app/(authenticated)/log/[id]/page.tsx`,
`app/(authenticated)/plans/page.tsx`, `app/(authenticated)/plans/new/page.tsx`,
`app/(authenticated)/plans/[id]/page.tsx`,
`app/(authenticated)/account/page.tsx`,
`app/(authenticated)/account/profile/page.tsx`,
`app/(authenticated)/account/friends/page.tsx` (drop stray eyebrow),
`app/(authenticated)/reports/new/page.tsx` (drop non-overlay shadow).
Confirm each uses gray neutrals, `rounded-lg`/`-md`, `blue-600` actions, and the
new shared cards/headers.

### Minor component cleanups
- `components/block-editor.tsx` — drop eyebrow.
- `components/route-external-links.tsx` — radius → `rounded-lg`; `stone`→`gray`.
- `components/route-segment-list.tsx` — radius → `rounded-lg`; drop eyebrow.
- `components/destination-picker.tsx`, `components/route-picker.tsx`,
  `components/user-popover.tsx` — these are floating menus/popovers; keep a
  single functional `shadow-sm` (allowed), `stone`→`gray`.
- `components/detail-sections.tsx` — apply the outlined difficulty-pill restyle
  only; keep the `SidePanel` uppercase header (canonical).
- `components/app-nav.tsx` — change the "Create Account" button from
  `rounded-full` to `rounded-md` to match the button token (otherwise already
  clean).

### Detail pages (reference — layout untouched)
`app/(public)/destinations/[id]/page.tsx`,
`app/(public)/routes/[id]/page.tsx` — no layout changes; they inherit the
difficulty-pill restyle through `detail-sections.tsx`.

## Out of scope
- The entire `app/admin/*` dashboard and `components/admin-nav.tsx`.
- OG/share images: `lib/seo-image.tsx`, `app/opengraph-image.tsx`,
  `app/twitter-image.tsx` (render images, not site UI; their gradients stay).
- Leaflet map components themselves (`*-map.tsx`) — tiles/markers unchanged;
  only their surrounding page chrome is in scope.

## Verification
- `cd web && npm run build && npm run lint` — both must pass with zero errors
  (pre-existing `<img>` warnings acceptable, per project CLAUDE.md).
- Guard grep over in-scope files must return nothing:
  `grep -rEn "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" web/src/app web/src/components` — excluding the documented exceptions (admin, seo-image, overlay `shadow-sm`, the `SidePanel` header).
- Visual spot-check in light **and** dark mode: discover (search empty + results),
  a card grid, lists, a trip report, login, the map page. Confirm no gradients,
  capped radii, outlined pills reading correctly, and `blue-600` actions.

## Non-goals
- No new color introductions beyond the per-type accents above.
- No layout/IA changes to pages — this is a visual-system pass, not a redesign
  of what each page shows.
- No animation/motion system beyond `transition-colors`.
