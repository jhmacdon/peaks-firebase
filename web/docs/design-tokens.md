# Peaks web — design tokens

Reference for every visual token the overhaul uses from Task 7 onward.
Canonical source: `docs/plans/web-overhaul.md` ("Global Constraints" and
"Design Tokens" sections) and `docs/audits/2026-08-19-strava-public.md`
(rationale). Implementation: `web/src/app/globals.css` (tokens),
`web/src/app/layout.tsx` (font loading).

Everything here is a CSS custom property registered through Tailwind 4's
`@theme`, so it's usable both as a Tailwind utility (`bg-page`, `text-ink`)
and as a raw variable (`var(--color-page)`) in one-off CSS.

## The laws (apply everywhere, not just detail pages)

1. **No box inside a box.** One rounded container per section
   (`rounded-media` / a hairline border). Never nest a card, a boxed stat, or
   another bordered panel inside it.
2. **Never box a stat.** Numerals stand on flat ground — no background,
   no border, no pill.
3. **Sections separate by whitespace, not dividers.** Use the section-rhythm
   spacing below; reach for a hairline only for rows *inside* a container.
4. **One filled primary action per surface.** Everything else on neutral
   fills, accent-text labels, or accent icons.
5. **Color only through tokens.** No raw Tailwind palette utilities
   (`blue-600`, `gray-900`, …) in any file a later task creates or modifies.
   The ~35 pages still on raw palette utilities are swept in Task 10+ — leave
   them alone until then.
6. **No hover lift/scale/shadow-grow.** Text links underline on hover;
   buttons may darken their fill slightly (≤8%). Shadows are reserved for
   floating chrome (see Shadows below).

## Color

Each row is one custom property with a light value and a dark override —
never two separate tokens. Components should not need a `dark:` variant for
any of these; the variable repaints itself under
`prefers-color-scheme: dark`.

| Token | Utility (`bg-`/`text-`/`border-`) | Light | Dark | Role |
|---|---|---|---|---|
| `--color-ink` | `*-ink` | `#21211F` | `#ECEAE6` | Primary text |
| `--color-ink-2` | `*-ink-2` | `#43423F` | `#C6C3BC` | Secondary text |
| `--color-muted` | `*-muted` | `#64635E` | `#96938A` | Muted text, stat labels |
| `--color-faint` | `*-faint` | `#8B8880` | `#797770`¹ | Lowest-emphasis text |
| `--color-border` | `*-border` | `#E0E0DE` | `#3A3936` | Control/card borders |
| `--color-hairline` | `*-hairline` | `#EDECE8` | `#2E2D29` | Row dividers inside a container |
| `--color-fill` | `*-fill` | `#F2F2F0` | `#282722` | Subtle inset surface |
| `--color-surface` | `*-surface` | `#F9F8F5` | `#201F1D` | Section container background |
| `--color-page` | `*-page` | `#FFFFFF` | `#181816` | Page background |
| `--color-accent` | `*-accent` | `#46ADBC`² | `#46ADBC`² | Brand teal — fills only |
| `--color-accent-text` | `*-accent-text` | `#1D7A8A` | `#7CC7D4` | Links, active states (AA on `page`) |
| `--color-alert` | `*-alert` | `#BA4C21` | `#E06A48` | Errors, destructive state |
| `--color-success` | `*-success` | `#2C6E49` | `#4E9A6B`¹ | Confirmations |

¹ `--color-faint` (dark) and `--color-success` (dark) aren't in the plan's
explicit dark list. Derived here, not authoritative from the plan:
`faint` sits at the same proportional position between `muted` and `border`
that light-mode `faint` occupies between light `muted` and `border`;
`success` is brightened to a comparable lightness bump as the plan's given
`alert` dark value, same hue family as light `success`. Both checked at
≥4.5:1 contrast against `page` and `surface`. Revisit if a future task wants
different values.

² `--color-accent` has a progressive-enhancement override: on displays that
support the P3 gamut (`@supports (color: color(display-p3 0 0 0))`), it
resolves to `color(display-p3 0.332 0.674 0.729)` instead of the sRGB hex.
Same override, both themes — the hue doesn't change between light and dark.

### Accent budget

Teal (`accent` / `accent-text`) is rationed, per surface:
- At most **one filled primary action** (`bg-accent`).
- The active-nav marker.
- In-component links/active states (`text-accent-text`).
- **Never** on headings, body copy, stat values, chart series, or large
  backgrounds. `--color-alert` is a separate token for errors — don't reach
  for accent there.

### Adding a light/dark toggle later

Dark values live in exactly one place: the `@media (prefers-color-scheme:
dark)` block in `globals.css`. To add an explicit user toggle, duplicate
that block's declarations under `:root.dark { … }` and have the toggle
add/remove the class — no other CSS restructuring required. Not built in
this task; scoped for later.

## Type

Two families carry all text; a third carries every numeral.

- **Display — Archivo** (`font-display` utility, variable, loaded via
  `next/font/google` with the `wdth` axis). Sets both the family and
  `font-variation-settings: "wdth" 125` — the wide cut, reserved for page
  H1s and marketing headings only. Weight 620–700 (set per heading via
  `font-[620]`-style arbitrary values — Archivo's variable range covers it).
  Sizes: 32 / 40 / 52 / 64px. Letter-spacing −0.015em.
- **Text — Geist** (`font-sans`, already loaded). **Two weights only: 400,
  500.** Never a third weight for body/UI text.
  - Body: 16px / 1.55 (the `<body>` default).
  - Small: 14px.
  - Meta / labels: 12–13px, +0.01em tracking.
  - Eyebrows: 11–12px, uppercase, 500, +0.1em tracking, `text-muted`.
- **Numerals — Geist Mono** (`font-mono-num` utility — an alias for
  `font-mono`/Geist Mono, named separately so a call site reads as "this is
  a numeral" rather than "this is generic code text"). Every stat value,
  everywhere, is Geist Mono — see StatCluster below.

### StatCluster scale

Four sizes, one shape: **Geist Mono value + a smaller inline unit span
(≈0.6em, `text-ink-2`) + a 12px muted label below.** Never a background,
never a border (law 2 above).

| Scale | Value size / weight | Use |
|---|---|---|
| `hero` | 56px / 300 | The one headline number on a page (e.g. a summit's elevation on its detail page) |
| `page` | 36px / 300 | Secondary page-level stats |
| `topline` | 28px / 300 | The flat metric row under page actions |
| `card` | 20px / 400 | Stats inside a card/list row |

Label: 12px, `text-muted`, sentence case, sits below the value — not
uppercase, not an eyebrow.

## Radius

| Token | Utility | Value | Use |
|---|---|---|---|
| `--radius-ctl` | `rounded-ctl` | 6px | Controls, inputs, buttons |
| `--radius-media` | `rounded-media` | 16px | Media, section containers |
| *(none — use `rounded-full`)* | `rounded-full` | 9999px | Chips, pills |

No other radius values. Arbitrary `rounded-[…]` is a violation of law 5 for
any file this system governs.

## Shadows

One token: `--shadow-float` → `shadow-float` utility.

```
0 6px 16px rgb(0 0 0 / 0.07), 0 0 1px rgb(0 0 0 / 0.2)
```

**Floating chrome only** — sticky nav once scrolled, dropdowns, popovers,
map controls, modals. Never on a resting card, section, or stat (law 6).

## Layout

Not new tokens — conventions expressed with stock Tailwind utilities (or one
arbitrary value where no stock scale step matches):

| Constant | Expression | Note |
|---|---|---|
| Content width | `max-w-[1200px] px-6` | No stock `max-w-*` step lands on 1200px |
| Marketing section rhythm | `py-28` | 112px — exact stock Tailwind step (`28 × 4px`) |
| App section rhythm | `py-12` | 48px — exact stock Tailwind step (`12 × 4px`) |
| Prose measure | `max-w-[68ch]` | Long-form body copy (About, trip reports) |

Sections separate by this rhythm, not a divider (law 3).

## Focus

Global `:focus-visible` is `outline: 2px solid var(--color-accent);
outline-offset: 2px;` — the one place accent appears outside the budget
above, since it signals keyboard focus rather than brand emphasis.
