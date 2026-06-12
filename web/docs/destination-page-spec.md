# Destination detail page — design spec

Redesign of `/destinations/[id]` modeled on the trail pages hikers already know:
WTA hike pages (e.g. wta.org/go-hiking/hikes/crystal-peaks) and AllTrails trail
pages. The goal is an editorial, information-dense reference page — not a
marketing landing page.

## Competitor research summary

**WTA hike page** (single main column + right sidebar):
- Breadcrumb → hike name → one-line teaser → photo.
- Compact stats block: Length / Elevation Gain / Highest Point / Difficulty /
  Coordinates / Rating. Values bold, labels small.
- Feature icons row (views, wildflowers, dogs, etc.).
- Long-form "Hiking X" prose section.
- Photo with small "Photo by …" credit line.
- Sidebar: "Before You Go" (weather, passes), "Getting There" (driving
  directions + parking), "More Hike Details" (region, land manager, guidebooks).
- Trip reports count + list, "Write a trip report" CTA.

**AllTrails trail page**:
- Photo hero, then title + rating + difficulty badge (Easy/Moderate/Hard).
- Stats row: Length · Elevation gain · Route type.
- Action row: Directions / Save / Share.
- Two-column: description + reviews on the left, sticky map + elevation
  profile on the right.
- "Nearby trails" rail at the bottom.

**Shared traits worth copying**: tight vertical rhythm, thin gray hairline
dividers instead of floating cards, bold-value/small-label stat presentation,
difficulty as a small colored pill, photo credits as captions (not overlays),
sidebar of short utility panels, everything left-aligned and scannable.

## Information architecture

```
Breadcrumb: Discover / {name}
Header row:   h1 name              [Directions] [Write a report]
              location · features meta line
Stats strip:  Elevation | Prominence | Routes | Trip reports | Sessions
Hero photo:   21:9 crop, caption credit below (omitted when no photo)

Main column (≈2/3)                 Sidebar (320px)
─────────────────────              ───────────────────
About {name}        prose          Stats        (dl: type, elevation,
Map                 leaflet +                    prominence, region,
                    coords/links                 coordinates)
Routes (n)          rows w/        Before you go (forecast, directions,
                    difficulty                   facilities from amenities)
                    pills          Seasonality   (12-month bar chart)
Trip reports (n)    rows           On lists      (list rows)
                                   Nearby        (destination rows)
```

## Layout

- Container `max-w-6xl`, `px-4 sm:px-6`, `py-6`. No full-page gradient
  background — plain `bg-white` / `dark:bg-gray-950`.
- Two-column grid `lg:grid-cols-[minmax(0,1fr)_320px]` with `gap-10`;
  stacks on mobile (sidebar after main content).
- Main-column sections separated by `mt-10`, not card chrome. Lists inside
  sections use `divide-y` hairlines.
- Sidebar panels: `rounded-lg border` with a `bg-gray-50` header strip —
  the only "boxed" UI on the page (mirrors WTA's sidebar modules).

## Typography

- h1: `text-3xl font-bold tracking-tight` (not 5xl — reference sites are modest).
- Meta line under h1: `text-sm text-gray-600`, parts joined with `·`.
- Section h2: `text-xl font-semibold`.
- Sidebar panel headers: `text-xs font-semibold uppercase tracking-wide`.
- Body prose: `text-[15px] leading-7 text-gray-700`.
- Stat values: `text-lg font-semibold`; stat labels `text-xs text-gray-500`.
- Coordinates render in the mono font.

## Color & shape

- Stay on the app palette: blue-600 primary, gray neutrals, semantic accents.
- Radii capped at `rounded-lg`. No `rounded-3xl`, no glassmorphism, no radial
  gradient washes, no decorative pills for plain text.
- Buttons are `rounded-md`: primary `bg-blue-600 text-white`, secondary
  `border bg-white hover:bg-gray-50`.
- Difficulty pills (computed via `summarizeRouteGuide`):
  Easy → emerald, Moderate → sky, Hard → amber, Strenuous → red
  (`bg-*-100 text-*-800`, dark `bg-*-900/40 text-*-300`).
- Full dark-mode coverage via `dark:` variants, as elsewhere in the app.

## Section specs

**Stats strip** — `grid grid-cols-2 sm:grid-cols-5` with `gap-px` over a
`bg-gray-200` base inside a `rounded-lg border` (reads as a ruled table).
Cells: value over label. Missing values render `—`, never hidden.

**Hero photo** — `<figure>` with `aspect-[21/9] object-cover rounded-lg` image
and a `text-xs text-gray-500` figcaption: `Photo: {attribution}` (linked when
an attribution URL exists). Entire block omitted when there is no image — a
page without a photo just starts at the content, like WTA.

**About** — guide headline + paragraphs from `buildDestinationGuide` as plain
prose. No "generated from the record" framing in the UI.

**Map** — existing `DestinationMap` (Leaflet/OpenTopoMap) in a bordered
rounded container. Below it a utility row: mono coordinates with a
copy-to-clipboard button, plus text links to OpenStreetMap and Google Maps.

**Routes** — `divide-y` rows, not cards. Each row: route name (link),
meta line `{mi} mi · {ft} ft gain · Est. {low}–{high}`, difficulty pill
right-aligned. Difficulty/time from `summarizeRouteGuide` with only
distance/gain available (shape unknown).

**Trip reports** — WTA-style: count in the heading, "Write a report" action on
the right, `divide-y` rows with title (link), `{author} · {date}` byline, and
a 2-line clamped text preview. Footer link "View all {n} trip reports".

**Sidebar — Stats** — definition list: Type, Elevation, Prominence, Region,
Coordinates. Label left in gray, value right in medium weight.

**Sidebar — Before you go** — utility links: NOAA point forecast
(`forecast.weather.gov/MapClick.php?lat&lon`, US destinations only),
Google Maps driving directions (`google.com/maps/dir/?api=1`). When the
destination has `amenities` (campsites), a Facilities sub-list renders
toilet / water / fee / reservation / capacity facts.

**Sidebar — Seasonality** — 12-bar mini histogram (Jan–Dec) from
`averages.months`, bar heights relative to the max month, single-letter month
labels, caption naming the top months. Panel omitted without data.

**Sidebar — On lists** — rows: list name (link) + destination count.

**Sidebar — Nearby** — `getNearbyDestinations` within 15 km (self excluded,
max 6): name (link), elevation, distance away. Mirrors AllTrails'
"Nearby trails".

## Data mapping

All data already exists; one extra query was added to the page load:

| UI element        | Source |
|-------------------|--------|
| Name, meta, stats | `getDestination` |
| Hero + credit     | `hero_image*` columns |
| About prose       | `buildDestinationGuide` |
| Map               | `lat`/`lng`/`boundary` |
| Routes + difficulty | `getDestinationRoutes` + `summarizeRouteGuide` |
| Trip reports      | `getTripReportsForDestination` / count |
| Seasonality       | `averages.months` (merged with offset) |
| Facilities        | `amenities` JSONB |
| Nearby            | `getNearbyDestinations(lat, lng, 15000)` |

## Non-goals (for now)

- Ratings/stars: no rating data exists; faking it would look exactly like the
  AI-generated filler this redesign removes.
- Elevation profile on this page: profiles belong to routes (which have
  geometry), and the route detail page already renders one.
- Permits/passes: no land-manager data in the schema yet.
