# Strava Signed-In Web Audit — Design System & UX Reference for Peaks

Audited live in Chrome as Josiah MacDonald (728 activities), 2026-08-19. Viewport 1728×934 @2x. All values are `getComputedStyle` reads, not estimates.

**Headline finding:** Strava's signed-in web app is *two design systems layered on top of each other*. A newer system (2024–2026: dashboard feed, segment pages, training log, routes, challenges, profile) uses the custom **Boathouse** typeface, near-black `#21211f` text, warm greys, 4px radii and a soft `0 8px 24px` shadow. An older system (activity detail, my-activities table, club pages) survives underneath with blue links `#007fb6`, `#dfdfe8` borders and denser tables. Peaks should copy the *new* system and treat the old one only as a source of information-density ideas.

---

## 1. Signed-in IA map

**Global nav** — 55px tall, white, `box-shadow: 0 1px 2px rgba(0,0,0,0.024)`, full-bleed. Logo (wordmark) · search magnifier · nav links · right cluster.

| Nav item | Type | Routes |
|---|---|---|
| Logo | link | `/` |
| Search | search overlay | — |
| **Dashboard** ▾ | hover menu | `/dashboard` · Activity Feed `/dashboard` · Clubs `/clubs/search` · My Segments `/athlete/segments/starred` · My Routes `/athlete/routes` · —*SUBSCRIPTION*— My Goals `/athlete/goals` |
| **Training** ▾ | hover menu | Training Calendar `/athlete/calendar` · My Activities `/athlete/training` · —*SUBSCRIPTION*— Training Log `/athletes/{id}/training/log` · Training Plans `/training-plans` · Power Curve `/athlete/analysis` · Fitness & Freshness `/athlete/fitness` |
| **Maps** | link | `/maps` (global heatmap) |
| **Challenges** | link | `/challenges` |
| Give a Gift | primary btn | promo |
| Bell | notification dropdown | badge "9+" |
| avatar ▾ | hover menu | Find Friends `/athletes/search` · My Profile `/athletes/{id}` · Settings · Apps · Subscriber Perks · Log Out |
| ⊕ | hover menu | Upload activity `/upload` · Add manual entry `/upload/manual` · Create route `/maps/create` · Create post |

**Other routes seen:** `/activities/{id}`, `/activities/{id}/segments`, `/activities/{id}/segments/{effortId}` (side panel), `/segments/{id}` (+ `?filter=overall|following|my_results|age_group|weight_class`), `/segments/{id}/local-legend`, `/clubs/{id}`, `/clubs/{id}/posts/{id}`, `/athletes/{id}` (tabs: Overview, Trophy Case, Following, KOMs/CRs/Top 10s, Local Legends, Posts).

Nav sub-menus visibly **label paywalled routes** with a small grey uppercase `SUBSCRIPTION` group header rather than hiding or badging them individually.

---

## 2. Page anatomies (top to bottom)

### 2a. Dashboard `/dashboard`

Three columns inside a **1248px fixed container**, flex row with 12px padding per column (24px gutters): **25% / 50% / 25%** → 294px · 612px · 294px of content.

**Left rail** (single continuous white module, not separate cards):
1. Avatar (shield/pentagon crop, ~72px, orange border), overlapping the module top.
2. Name (14px), then a 3-up stat strip: **Following 71 / Followers 47 / Activities 728** — value 20px/25px above 12px label, hairline divider under.
3. `Latest Activity` label + bold activity name · date.
4. `Your streak` — a flame chip showing "10 Weeks" beside a 7-day M–S row; days with activity are filled black circles, today is an outlined circle, future days are plain numerals.
5. `Your Training Log ›` row (chevron affordance).
6. **Sport tab strip** — 4 icon-only tabs (chart / run / bike / swim), active tab has a light fill.
7. **Relative Effort module**: small orange badge icon + `RELATIVE EFFORT` (12px uppercase, `#64635e`) · verdict headline in a *state colour* (`Below weekly range` = `#bc6ded` purple, 20px/600) · two lines of plain-English coaching copy · `THIS WEEK` uppercase label · a tiny 7-bar sparkline beside **Score 10** and **Range 96–191** · a 6-week line chart with dated x-axis and the current week highlighted in purple.
8. `Manage Your Goals ›`.

**Centre column:** feed filter select (`Following` / `My Activities` / then each of the athlete's clubs by name), then an infinite card stack, 16px vertical gap.

**Right rail:** `Challenges` promo (circular icon + heading + copy + orange text link) · `Your Clubs` (4-up 44px logo grid + `View All Clubs` outline button) · `Suggested Friends` (avatar + name + reason line + small ghost-orange `Follow` button ×3, then `Find and Invite Your Friends`) · footer link cluster + language/about selects. **The right rail is not sticky** — it ends and the footer links sit in the same column while the feed keeps scrolling.

**Feed card anatomy** (612×auto, white, radius 4px, shadow `0 8px 24px rgba(13,13,18,0.04)`, zero card padding — each internal section owns its own):
- **Header** (`padding: 16px 24px 0`): 40px square avatar · athlete name (14px/600, `#21211f`) · meta line `Today at 8:39 AM · Garmin Forerunner 235 · Seattle, Washington` (12px/`#43423f`, letter-spacing 0.12px) · caret ▾ at far right.
- **Body** (`padding: 0 24px 16px`): sport glyph icon on its own line; activity **title 22px/600/28px** (omitted when the activity is untitled — the emoji/description takes its place); optional description; **stat row** — 3–4 stats, each `20px/25px` value with the unit rendered as a smaller inline `.unit` span, over a `12px #43423f` label; `Achievements 🏆 3` sits as the right-most "stat".
- **Achievement lines** (12px): `Mt. Side Dr. TH to 1st intersection **PR** (8:25)` — segment name in body colour, `PR` bolded.
- **Media**: full-bleed edge-to-edge inside the card, radius 2px. Map and photos share one row and split the width (map 50% + photo 50%, or map full-width above a 2-up/3-up photo strip). Peloton/indoor cards drop the map and use a video still with a small dark source chip.
- **Footer** (`padding: 0 24px`): stacked kudos avatars (20px, overlapping) + `5 kudos` / `Be the first to give kudos!` / `23 kudos · 1 comment`; right side two 32px icon buttons (kudos, comment) on `#f2f2f0` fill, radius 4px.
- **Inline comments** render beneath the footer: 32px avatar, name, timestamp right-aligned, body, and a small heart.
- Map cards also carry a `Save Route` 30px outline button (11px/600, border `#e0e0de`).

**Non-activity feed card types**, all in the same container but visually lighter:
- **Challenge join**: `Nick Walker joined a challenge` header line (name bold, verb regular) · hairline · 76px badge art + title 22px + one-line description + orange `Join Challenge` button.
- **Club join**: same shape — logo tile + club name + `421 members · Seattle, Washington` + orange `Join Club` button.
- **Workout with no GPS**: header + title + stats only, then straight to the kudos footer. No empty map placeholder.

### 2b. Activity detail `/activities/{id}` — the primary reference

Page background is **`#ffffff`** here (not `#fafafa`). Content column is 1037px with a 154px left sidenav outside it.

Top to bottom:

1. **Left sidenav** (154px, sticky beside the content, not inside it): `Overview` (active = 3px orange left bar + light fill) · grey `SUBSCRIPTION` group label · `Relative Effort` · `Segments` · `Matched Activities`. Below it a 2-up button pair: edit and ••• more. These are **routes, not anchors** — Segments is its own page.
2. **Title bar** (bordered box, `1px solid #dfdfe8`): activity-type crest icon + `Josiah MacDonald – Hike` (20px/400) on the left; on the right a row of quiet icon actions: share, kudos `0`, comments `0`, and a collapse caret.
3. **Two-column summary block inside that same bordered box**, split by a vertical hairline at 8/4:
   - **Left (518px, `padding: 0 15px`)**: 80px activity crest/photo · timestamp + place line `6:42 AM on Friday, August 7, 2026 · Pike National Forest, Colorado` (12px grey) · **H1 activity name, 28px/34px/600, letter-spacing −0.28px** · `Add a description` ghost chip · `Add private notes` chip · `With someone who didn't record? [Add Friends]` · `STRAVA LABS / View Flybys ›`.
   - **Right (488px)**: `.inline-stats` — **4 topline stats, 28px at weight 300**, unit as an 18.2px inline span, label 12px `#6d6d78` beneath. Relative Effort is the 4th and is **colour-coded by magnitude** (`324` in `#b40312` labelled "Historic/Massive Relative Effort"). Below, `.more-stats` — a 2×2 label/value grid at 12px (Elevation, Calories, Elapsed Time, Steps) with values right-aligned and bold. Below that `.weather` — a sun glyph plus a 2×3 grid (Temperature, Humidity / Feels like, Wind Speed, Wind Direction). Below that `.device-section` — `Garmin fēnix 8 Solar` and `Shoes: —`.
4. **Progress strip** (own bordered row, 3 cells): `2 Activities on this route ›` + `This Activity 2.2 mi/h` + `Trending Faster ▲` · a tiny sparkline with the current effort marked in orange · a coaching cell (`Nice Work! Complete this route again…` + `Learn More`) **or** a `View Matched Activities` button.
5. **Achievements strip**: a big ghosted laurel-wreath graphic reading `TOP RESULTS` on the left, then a list of achievement lines: medal glyph + `PR on [Crystal Lakes Trail Climb] (37:42)`.
6. **Splits + Map row** — one bordered box split horizontally: `Splits` heading centred over a **252px dense table** (`Mile | Pace | Elev`, header 14px/600, rows 29–30px, 5px vertical cell padding, units as small inline spans) and, to its right, an **800×451 interactive map**. A drag handle sits on the boundary between this row and the chart below (resizable).
7. **Elevation / pace chart** — 960×280 SVG, full content width. Grey elevation *area* + coloured metric *lines*, **dual y-axes** (elevation ft on the left, pace on the right), distance on x. Below it a **metric toggle row**: `Pace [on]` / `Heart Rate [ ]` / `Cadence [ ]` as small pill switches (active = green), and under that an `Avg` row printing each metric's average with its unit.
8. Footer: `Your Recent Activities` (5 links with sport glyphs) + `Strava Stories`, then the global footer.

**Segments live on `/activities/{id}/segments`**, not inline: a small elevation profile at top, `Segments` heading, then a table `☆ | medal | Name | Time | Distance | Pace | Elev Diff | HR` (thead `#f7f7fa`, th 600 with `1px #dfdfe8` under, rows 35px). Clicking a row keeps the table on the left and opens a **right-hand effort panel** — see §6.

### 2c. Own profile `/athletes/{id}`

1. **Photo mosaic hero**, full-bleed to the 1248 container: 3 large tiles + 1 tall tile + 2 small tiles, no gaps, ~270px tall, drawn from the athlete's own activity photos.
2. **Avatar** in the signature shield/pentagon crop with an orange border, overlapping the mosaic's bottom-left.
3. **Identity block** (three columns on one baseline):
   - Left: **H1 name 28px/600/−0.28px**, then badge rows with glyphs — `Subscriber`, `Seattle, Washington`. On another athlete: a `Following ▾` split button and `Primary Club: [link]`.
   - Centre: `Last 4 Weeks` (14px/600) over a **72px/88px weight-700 numeral** over `Total Activities` (12px `#6d6d78`).
   - Centre-right: **28-day dot calendar** — M T W T F S S header, 4 rows; each day is a dot whose diameter scales with volume, `·` for rest days, today's date shown as an underlined numeral.
   - Right: **sport legend + horizontal bars** — coloured dot + sport glyph per sport, then one pale-track bar per sport with the total time (`1h 47m`) as an inline label.
4. Dismissible **promo panel** (`#f7f7fa`, 20px padding, X at top-right).
5. **Tab bar**: Overview · Trophy Case · Following · KOMs/CRs/Top 10s · Local Legends · Posts. Active tab = white fill + orange top border.
6. `Trophies` + `View more` link — challenge badge art (~78px) with title (blue link) and month/year beneath.
7. `Achievements` — medal glyph + `2nd fastest time on [segment] (54:52)` + italic grey `3 weeks ago`.
8. `Photos` — 8-across 76px thumbnails, last tile shows `+ 93`.
9. `Activities for Aug 17 – Aug 23, 2026` + a date-range dropdown; a summary line `0.2 mi | 0h 49m | 0 ft` (bold value, small unit); a **weekly bar chart** spanning 12 months with `Time / Distance / Elev Gain` and `Weekly / Monthly` segmented controls beneath (active segment = dark grey fill, white text); then that week's activities as ordinary feed cards.
10. **Right rail**: `Clubs` logo grid · `Social Stats` (label 12px grey over a **24px/300 number in link blue `#007fb6`**) · `My Stats` (sport icon tabs over a zebra table: *Last 4 Weeks* → Activities/Week, Avg Time/Week, Avg Distance/Week; a year dropdown → Activities/Time/Distance; *All-Time* → same) · `Refresh Stats` secondary button · `Share Your Activities`.
11. On another athlete: `Both Following` mutual-avatar row and a **`Side by Side Comparison`** table — sport tabs, then two avatar-headed columns comparing Last 4 Weeks metrics and All-Time PRs (1 mile, 2 miles, 5k…), your column showing `—` where you have no data. This is the single most persuasive social widget on the site.

### 2d. Training Log `/athletes/{id}/training/log`

Breaks the 1248 container — **full-bleed with 24px page gutters**.

1. **H1 `Training Log`** 34px/600.
2. **Control bar**, `1px #f2f2f0` underneath: three selects (`All` sports · `Distance` metric · `Activity Tag`), then an inline **colour legend** of sport types (8px dot + 12px label) with a `+53 more` overflow, then a right-aligned `Private` toggle.
3. **Calendar grid** — sticky header row: year on the left, `Mon…Sun` as 10px column heads. One row per week, `1px #f2f2f0` divider between:
   - Left cell (242px): week range `Aug 10 – 16` (20px/600, `#21211f`), then `Total Distance` (10px `#64635e`) over `4.17 mi` (20px/400).
   - Seven day cells: each activity is an **SVG circle whose radius encodes the chosen metric** (max r≈49) and **whose fill encodes the sport**, with the value printed inside in white bold and the activity name in 10px beneath. Empty days print `Rest` in 10px/600 `#e0e0de`. Today is marked `Today` in `#fc5200` with a small triangle pointer.
4. **Right rail jump list**: `2026 / Aug Jul Jun … Jan`, then collapsed year rows `2025 2024 … 2018`, with a vertical scroll-position indicator bar.

Sport palette read from the DOM: Hike `#2c520e` · Run `#70cf25` · Walk `#a9e27c` · Stand Up Paddling `#004ca6` · Pickleball `#997700`. Dark-to-light greens for foot sports, blues for water — a *semantic* family palette, not an arbitrary categorical one.

### 2e. Training Calendar `/athlete/calendar`

1. H1 34px/700, `#242428`.
2. `‹ 2026 ›` year stepper (22px/700).
3. **52-week sparkline** (thin blue bars on a baseline) labelled `52 WEEKS`, sharing a row with **four year totals**: `89 Hours` (value in link blue — it's clickable), `181.4 Miles`, `13 Personal Records`, `67 Activities`. Values 35px weight 300, labels 12px `#6d6d78`.
4. **4×3 month grid**: each month a `#f7f7fa` tile, ~250×200, month abbreviation right-aligned in grey caps, a 30px/300 hours number with a `HOURS` micro-label, and a bottom-anchored bar chart of that month's sessions. Future months render as empty tiles — the year's shape stays legible.

---

## 3. Design tokens

### Typography
Single family everywhere — **`Boathouse`**, Strava's proprietary sans, loaded at weights 300/400/500/600/700/900 plus italics, with a `BoathouseCondensed` companion.

```
font-family: Boathouse, "Segoe UI", "Helvetica Neue", -apple-system, system-ui,
             Roboto, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Symbol";
```

| Role | Size / line-height | Weight | Colour | Notes |
|---|---|---|---|---|
| Body / base | 14 / 18 | 400 | `#000` | `<body>` default |
| Long-form prose (post) | 16 / 24 | 400 | `#000` | 695px measure |
| Page H1 (new pages) | 34 / 41 | 600–700 | `#000` / `#242428` | ls −0.34px |
| Page H1 (activity, profile) | 28 / 34 | 600 | `#000` | ls −0.28px |
| Segment H1 | 32 / 41 | 600 | `#000` | |
| Post H1 | 48 / 52.8 | 400 | `#000` | |
| Section head | 22 / 28 | 600 | `#000` | "Achievements", "Leaderboards" |
| Rail head | 20 / 28 | 600 | `#000` | "Suggested Friends" |
| Feed activity title | 22 / 28 | 600 | `#21211f` | |
| **Topline stat (activity)** | **28 / 33.6** | **300** | `#000` | unit 18.2px inline |
| **Hero numeral (profile)** | **72 / 88** | **700** | `#000` | |
| Stat (calendar / segment) | 35 / 42 · 24 / 25 | 300 · 400 | `#242428` / `#000` | |
| Stat (feed card, rail) | 20 / 25 | 400 | `#21211f` | unit inline, same size |
| Stat label | 12 / 14.4–18 | 400 | `#6d6d78` / `#43423f` | sentence case, **not** uppercase |
| Micro label | 10 / 11 | 400–600 | `#64635e` / `#e0e0de` | training-log only |
| Eyebrow / group label | 12 / 18 | 400 | `#64635e` | `text-transform: uppercase` |
| Meta line | 12 / 16 | 400 | `#43423f` | ls 0.12px |
| Nav link | 14 / 18 | 400 | `#494950` | active adds orange underline |
| Table header | 14 / 18 · 16 | 600 · 700 | `#000` | sentence case |
| Table cell | 14 · 16 | 400 | `#000` | |
| Button label | 12–14 | 600–700 | — | |

**Critical:** there is **no monospaced or tabular numeral font anywhere.** Every number — hero numerals, splits tables, leaderboards — is set in Boathouse. Big numbers get their weight from *size and light weight (300)*, not from a mono face. Units are always a smaller inline span in the same colour, never a separate label.

### Colour

```
/* brand */
--orange            #fc5200   /* primary buttons, active nav underline, "Today", links in new UI */
/* text */
--text-primary      #000000
--text-near-black   #21211f   /* new components */
--text-strong-alt   #242428   /* newest pages */
--text-secondary    #43423f
--text-tertiary     #64635e
--text-muted        #6d6d78   /* stat labels */
--text-nav          #494950
--text-disabled     #e0e0de   /* "Rest" */
/* links */
--link-legacy       #007fb6   /* activity page, tables, social stats */
--link-new          #0060d0
/* surfaces */
--page-bg-feed      #fafafa
--page-bg-detail    #ffffff
--card-bg           #ffffff
--fill-subtle       #f7f7fa   /* promo panels, thead, month tiles */
--fill-quiet        #f2f2f0   /* icon buttons, dividers, thead (new) */
--fill-table-head   #f0f0f5   /* legacy tables */
--charcoal          #43423f   /* leaderboard filter nav bg */
/* borders */
--border-new        #e0e0de
--border-legacy     #dfdfe8
--border-hairline   #f2f2f0
/* state / semantic */
--effort-low        #bc6ded   /* "Below weekly range" */
--effort-historic   #b40312   /* "Historic/Massive Relative Effort" */
```

The orange is used **sparingly and only where it means "act" or "now"**: one primary button per surface, the active nav underline, the `Today` marker, achievement medals, and text links inside new components. It never tints a background, a chart, a map line on a card, or a stat.

### Chart palette (SVG-level reads)

```
grid lines        #eeeeee  1px   (h + v)
axis domain       #aaaaaa  1px
tick labels       #999999  11px
hover crossbar    #333333  1px ; label #666666 14px
tooltip           fill #ffffff, stroke #dfdfe8 1px
elevation area    #000000 @ opacity 0.15   (a grey wash, never a colour)
pace / speed line #34ace4  1.5px
heart-rate line   #dd0447  1.5px
PR reference line #fc5200  dashed
```

### Layout & elevation

| Token | Value |
|---|---|
| Nav height | 55px |
| Container | **1248px** fixed, centred (`padding: 0 16px` inside) |
| Dashboard columns | flex `0 0 25% / 50% / 25%`, each `padding: 12px` → 294 / 612 / 294 |
| Wide pages (training log) | full-bleed, 24px gutters |
| Prose measure | 695px |
| Card radius | **4px** (media & newest cards 2px) |
| Card shadow | `0 8px 24px rgba(13,13,18,0.04)` (routes: `…0.05`) |
| Nav shadow | `0 1px 2px rgba(0,0,0,0.024)` |
| Dropdown shadow | `0 6px 10px rgba(0,0,0,0.05)` |
| Feed card padding | `16px 24px 0` header · `0 24px 16px` body · `0 24px` footer |
| Card gap | 16px |
| Avatars | 40px (feed) · 20px (kudos stack) · 32px (comment) · 76–78px (profile, shield crop) |

### Buttons

| Variant | Spec |
|---|---|
| **Primary** | bg `#fc5200`, text `#fff`, `padding: 6px 16px`, radius 4px, 12–14px / **600–700**, height 30–32px, 1px border same as bg |
| **Secondary / outline** | bg `#fff`, text `#242428`, `1px solid #dfdfe8`\|`#e0e0de`, radius 4px, `padding: 6px 16px`, 14px/600, height 30–34px |
| **Ghost-orange** (Follow) | transparent bg, text `#fc5200`, `padding: 4px 8px`, radius 4px, 12px/600 |
| **Text link button** | transparent, `#fc5200`, `padding: 6px 10px`, 14px/600 |
| **Icon action** (kudos/comment) | 32×32, bg `#f2f2f0`, radius 4px, no border |
| **Segmented control** | active = dark grey fill + white text; idle = transparent |
| **Vertical filter nav** (leaderboard) | items 240×32, bg `#43423f`, white 13.3px, `padding: 8px 20px`; active item bg `#fc5200` |

---

## 4. Component specs worth lifting

**Stat cluster.** The atomic unit across the whole product: `value (large, light weight, unit as smaller inline span) over label (12px, muted, sentence case)`. It is **never boxed, never bordered, never given a background.** It appears at four scales — 72px hero, 35px page-level, 28px activity topline, 20px feed card — always with the same 12px label. Peaks' "no box inside a box" rule is already aligned; Strava's addition is the *inline unit span* and the *light 300 weight at large sizes*.

**Card.** White, 4px radius, one soft ambient shadow, **no border** on the feed; a 1px `#e0e0de` border appears only on right-rail cards where the shadow alone would not separate them. Zero padding on the card itself — each internal band owns its padding, which is why media can bleed edge to edge.

**Dense table.** `thead` gets a light fill (`#f7f7fa` / `#f2f2f0` / `#f0f0f5`), header 600–700 in sentence case, `1px` bottom border; rows 30–46px with 4–6px vertical cell padding; numeric columns get units as small inline spans; the actively-sorted column is shaded. Row hover is the only interaction affordance — no zebra on new tables, zebra retained on legacy ones.

**Notification dropdown.** 350px wide, white, `0 6px 10px rgba(0,0,0,0.05)`, rows 53–55px separated by `1px #e0e0de`. Each row: 32px avatar/icon · bold title · body line · timestamp. **Unread rows carry a pale peach tint**; read rows are white. No "mark all read" chrome.

**Left rail nav (activity page).** 154px, items 40px, active state = 3px orange left bar + faint fill, with a grey uppercase `SUBSCRIPTION` group divider mid-list.

**Route card.** 280px, radius 4px, shadow `0 8px 24px rgba(13,13,18,0.05)`. Map thumbnail on top (280×175, orange route on a muted OSM basemap), then `padding: 6px 16px 16px`: meta row (11px date left; ★ + ••• right), title 15px/600 truncated to one line, stats row of 12px `#43423f` values each preceded by a thin line icon.

**Empty / 404.** Full-illustration page ("Sorry, this one stays red." with a traffic-light and abstract route graphic in purple/sand) plus a bulleted list of concrete next steps. Worth copying the tone, not the art.

---

## 5. Chart & data-viz patterns

1. **Grey for context, colour for the measured thing.** Elevation is always a black-at-15% area fill; only the *selected metric* gets a hue (`#34ace4` pace, `#dd0447` HR). Never two saturated series competing.
2. **Metric toggles below the chart, not a legend.** `Pace [on] / Heart Rate / Cadence` pill switches, with an `Avg` row beneath printing each metric's average. The chart is a viewer; the toggles are the legend.
3. **Dual axes without apology.** Elevation ft on the left, pace on the right, distance on x. Ticks at 11px `#999`, gridlines at `#eee`.
4. **Vertical crossbar on hover** (`#333`, 1px) with a value label in `#666` and a white tooltip box outlined `#dfdfe8`.
5. **Encode magnitude with area, category with colour.** The training-log circle grid is the strongest example: r ∝ metric, fill = sport, value printed inside. It reads as a year of training at a glance and drills to a day.
6. **Reference lines beat annotations.** `Your Recent Efforts` uses a dashed orange PR line across the plot labelled `PR / 37:42` at the right edge; the y-axis is *inverted* so faster is higher.
7. **Sparklines as compression.** The 52-week bar strip, the profile's per-sport bars, the Relative Effort 7-bar micro-chart, the "activities on this route" strip — all sub-40px tall, no axes, one label.
8. **Everything is togglable at two granularities**: `Time / Distance / Elev Gain` × `Weekly / Monthly`.

---

## 6. How social proof is presented

Strava's real product is comparison, and every surface carries a piece of it.

- **Kudos** are a count plus a stacked row of 20px avatars — identity first, number second (`[avatars] 5 kudos`). Empty state is a friendly prompt, not a `0`: **"Be the first to give kudos!"**
- **Achievements on a feed card** are compressed to one line each, above the map: `Mt. Side Dr. TH to 1st intersection **PR** (8:25)`. The card header also shows `Achievements 🏆 3` as a stat, so the count is visible before the detail.
- **Medal semantics** are consistent: gold/silver/bronze trophy glyphs for 1st/2nd/3rd fastest, a distinct `PR` medal, and a crown for KOM/QOM/CR.
- **The laurel wreath** — a large ghosted `TOP RESULTS` graphic on the activity page — turns "you got a PR" into a moment without a modal or confetti.
- **Segment effort panel** stacks four kinds of proof in one column: *This Effort* time large, then a **Local Legend** card (avatar + name + "2 efforts in the last 90 days" + `View Local Legend Stats`), then a grey CR panel (`CR (everyone) 20:57` / `CR (men) 20:57` / `CR (women) 22:21` / hairline / `MY PR 37:42` / **`284 /625`**), then a 2×3 grid of leaderboard cuts (Overall, People I'm Following, My Efforts, By Age Group, Compare, By Weight Class — paywalled cuts marked with a small orange glyph).
- **Rank is always a fraction, never a bare number**: `284 / 625`, `479 / 1082`. It reframes a mediocre rank as participation.
- **Segment page right rail**: `Your Stats` (All-Time PR + date + effort count) above `Fastest Times` (CR / KOM / QOM with avatars and dates) above `Most Efforts` (the Local Legend). The athlete's own line comes *first*, the elites second.
- **Leaderboard header strip** puts `MY CURRENT PLACE` and `MY BEST TIME` as two 24px stats to the left of the filter dropdowns — your row is summarised before you scan the table.
- **Club leaderboards** run two patterns side by side: a three-column podium (`Distance / Total Running Time / Climbing`, each with medals + avatar + value) and a full sortable weekly table.
- **Side by Side Comparison** on another athlete's profile — two avatar-headed columns over Last 4 Weeks and All-Time PRs, showing `—` where you have no entry.
- **Attempt counts as ambient proof**: `1,154 attempts by 1,082 people | Starred by 1 person` under the segment stats.
- Notifications are almost entirely social (`Conor Green gave you kudos on Morning Pickleball`) or self-congratulatory (`Way to go, Josiah 👏`).

---

## 7. Top 12 patterns the Peaks web app must copy

1. **The unboxed stat cluster at four scales** — value (light weight, unit as a smaller inline span) over a 12px muted sentence-case label, 72 / 35 / 28 / 20px depending on altitude. It is the single most reusable atom on Strava and it already matches the Peaks "never box a stat" rule.
2. **The three-column 1248px dashboard: 25 / 50 / 25.** Identity + streak + effort on the left, the feed at 612px, discovery on the right. For Peaks: left = you and your summit streak, centre = sessions, right = nearby peaks and areas.
3. **The feed card as the universal container** — zero card padding, per-band padding, edge-to-edge media, footer social row. One component absorbs activity, photo-only, challenge, and club-post variants without new chrome. Peaks needs exactly this for sessions, summits, and route posts.
4. **Achievements compressed to one line above the media.** `Mt. Side Dr. TH to 1st intersection **PR** (8:25)` costs 12px of height and does the work of a badge shelf. This is the answer to the still-open Peaks summit-trophy moment: a line, not a card.
5. **Rank as a fraction, plus your own number first.** `284 / 625`, `MY CURRENT PLACE 479 / 1082`, `Your Stats` above `Fastest Times`. Peaks ascent counts and area completion should read the same way — your position framed by the crowd, never a bare rank.
6. **The training-log circle grid** — radius ∝ metric, fill = sport, value inside, `Rest` in near-white. A whole season of summits and ski days on one screen, with a colour family (dark→light greens for foot travel, blues for water) rather than an arbitrary categorical ramp.
7. **Grey for context, one hue for the measured series, toggles instead of a legend.** Elevation as a 15%-black area under a single coloured line, with `Pace / Heart Rate / Cadence` pill switches and an `Avg` row beneath. Peaks elevation profiles should adopt this wholesale.
8. **Semantic colour on a single stat, not on the layout.** Relative Effort is purple when low and deep red when historic — the number itself carries the verdict, and nothing else on the page changes. Cheap, legible, and it keeps the accent budget intact.
9. **One orange, spent on one thing per surface.** Primary button, active nav underline, `Today`, medals. Never a background, never a chart series, never a stat. Peaks teal should be rationed the same way.
10. **Route/place cards: map thumbnail, then meta row, then title, then icon-prefixed stats.** 280px, 4px radius, one soft shadow, title truncated to one line. Directly transferable to Peaks routes and places grids.
11. **Filter chrome that names your own data.** The feed filter lists `Following / My Activities / <each of your clubs by name>`; leaderboards expose `Overall / People I'm Following / My Clubs / By Age Group`. Peaks should offer the same *personal* cuts (my region, my peak list, people I follow) rather than generic sorts.
12. **Progressive disclosure by route, not by accordion.** Segments, Relative Effort, and Matched Activities are separate pages reached from a 154px left rail with an active orange bar; the Overview stays scannable. Peaks place and session detail should push depth to sibling routes instead of growing the page.

**One thing not to copy:** the legacy activity-detail shell (blue `#007fb6` links, `#dfdfe8` borders, bordered heading box, resizable splits/map row). It is visibly older than the rest of the product and reads as unmaintained. Take its *information architecture* — the section order in §2b — and render it in the new system's tokens.
