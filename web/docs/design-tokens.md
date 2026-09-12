# Peaks web design

The September 2026 site audit sets the current direction: photo-led discovery,
clear planning actions, compact personal summaries, and readable controls.
Use AllTrails as a reference for ease of use; keep Peaks’ teal and its focus on
mountain routes, peak lists, and recorded activity.

## Layout

- Start the homepage with search and a real landscape photo. Put regional entry
  points and useful guides before app promotion and catalog counts.
- Use a 1200px content width, 24px page inset, and 48–64px between major sections.
  Phone headers should leave room for useful content in the first screen.
- Keep title, personal activity, short credited place copy, catalog facts,
  photos, sessions, then routes on place and activity details. Section links
  help readers move through long pages.
- Put related personal stats in one summary. Lead with the strongest count and
  recent context, then show distance, elevation, and time in a compact row.
- Add a card when it groups related content. Avoid grids of large equal stat
  boxes and cards nested inside cards.
- Desktop navigation includes Discover, Map, Lists, Areas, Log, Trips, and Saved.
  Phone tabs keep Discover, Map, Lists, Saved, and Log; Trips stays in the
  account menu. Guests get a sign-in tab. Keep the account menu on both widths.
- Trips are dated plans with a party and itinerary. Published routes are guides.
  Keep `/my-routes` and `/plans` working as existing links; label the plan UI Trips.

## Color

Tokens live in `src/app/globals.css`. Each color has a light value and an OS-dark
value. Use token utilities so components follow both themes.

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#21211F` | `#ECEAE6` | Main text |
| `ink-2` | `#43423F` | `#C6C3BC` | Supporting text |
| `muted` | `#64635E` | `#96938A` | Metadata |
| `faint` | `#6E6B64` | `#A19D93` | Lower emphasis text and credits |
| `border` | `#E0E0DE` | `#3A3936` | Control and card edges |
| `hairline` | `#EDECE8` | `#2E2D29` | Row dividers |
| `fill` | `#F2F2F0` | `#282722` | Quiet fills |
| `surface` | `#F9F8F5` | `#201F1D` | Grouped sections |
| `page` | `#FFFFFF` | `#181816` | Page background |
| `accent` | `#46ADBC` | `#46ADBC` | Main action |
| `accent-text` | `#1D7A8A` | `#7CC7D4` | Links and active controls |
| `alert` | `#BA4C21` | `#E06A48` | Errors and destructive controls |
| `success` | `#2C6E49` | `#4E9A6B` | Completed states |

Use teal with restraint: one filled main action per surface. Main buttons use
fixed dark ink on teal; white on this teal does not have enough contrast.
Photo overlays use fixed white text over a dark scrim because the photo does
not change with the page theme. Credits must remain readable and linked.

Area selections use Peaks teal, a narrow pale edge, and a low-opacity fill.
Retain map attribution. Do not let a selection obscure the terrain.

## Type and controls

- Archivo at width 110 for page titles; Geist for body text and stats.
- Field guides use the system serif stack for titles and prose, with a 720px
  reading column and 19–23px body text. Keep the chapter ahead of its map,
  with a map link near the title and source notes after the prose.
- Body and inputs: 16px. Supporting text: 14px. Credits: at least 12px.
- Use 500–600 weights for controls and card titles. Keep numerical values in
  normal sans text with tabular figures. Reserve monospace for technical data.
- `StatCluster`: 56/36/28/20px values by scale, with a smaller inline unit and
  a 14px sentence-case label. Show units and describe whether route figures
  are one-way, round-trip, or whole-trail totals.
- Main buttons and fields are at least 48px tall; small buttons and selectable
  chips are at least 44px. Buttons use a pill shape, fields a 12px radius,
  and media a 16px radius.
- Keep visible labels, a strong keyboard focus ring, and usable disabled states.
  A placeholder does not replace a label. Preserve user edits after errors.
- Use inline validation and retry controls. Confirm deletion beside the object
  being deleted. Do not rely on native alert dialogs or leave a spinner running
  when a request fails.

Font variables use Tailwind `@theme inline`; consume `font-sans`, `font-display`,
`font-mono`, or `font-mono-num` utilities. Do not use the font alias variables
as raw CSS values; Next declares their source variables on the body.

## Browse cards and photos

`CatalogMedia` gives places, routes, lists, and areas one 16:10 media shape.
Use a real credited photo where available. Place cards without a photo can use
a coordinate-centered satellite thumbnail from the existing Esri image export.
If neither source works, show an explicit no-photo state; never substitute a
photo of a different place. Keep titles and location visible below the image.

Use lazy responsive images. Local and Firebase/Google Storage images use Next
image sizing; other existing catalog hosts load directly. Show the source and
license attribution supplied by the catalog. Keep card save buttons separate
from the card link. `SavedPlacesProvider` shares one status request across cards.

Activity photos belong to an outing. Group an even spread from recent published
reports by activity name, date, and type. Link to the full image. Do not turn
private activity data into a public gallery or use an ungrouped newest-N feed.

The app images in `public/app` come from the iOS repository’s recorded UI checks.
They show the actual app. The dated air-quality example is labeled as a preview.

## Search and state

Discover and Map share typed URL filters, count and page queries, and selected
item IDs. Preserve filters when switching views, opening a selection, returning
from sign-in, and paging. A new filter resets the page. Location access starts
only after the user chooses it. Distinguish loading, no results, and failures.

Search and browse must provide access to the whole matching set. Keep queries
bounded with pagination, exact totals, and stable ordering. Retain the selected
route’s geometry or protected-area boundary when showing it on the map.

## Motion and chrome

Use color changes for hover; avoid card lift and scale. Reserve shadows for
floating controls and menus. Respect reduced motion. Keep the fixed phone tabs
and safe-area spacing in place on every public/member page. Full-screen map
views own their scroll area and omit the footer.
