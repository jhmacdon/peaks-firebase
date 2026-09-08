# Website audit implementation — September 7, 2026

The site now uses a shared, search-led design inspired by AllTrails while keeping Peaks branding, catalog data, and trip history. This change covers the public, member, and admin template families from the website audit.

## Changes

- Shared design: clearer type, consistent photo cards, larger controls, compact stats, restrained teal, and phone navigation with reachable Saved and account actions.
- Home, Features, About, state, and activity pages: lead with search and places; offer manual region choices; show real iPhone screenshots with capture context; link hiking visitors to routes filtered by distance and gain.
- Discover and Map: share typed URL filters, result counts, sorting, pagination, location choices, and selected guides. Selected routes retain their geometry; areas show their boundary. Location permission follows an explicit action. Failed searches and tiles have recovery controls.
- Destinations, routes, and areas: use section navigation, personal activity summaries, sourced place copy, catalog facts, activity-grouped public photos, and fuller route/place lists. Planning notes state when current access information is unavailable. Weather uses Fahrenheit. Routes lead to trip planning with the chosen route carried through sign-in.
- Lists: paginate the index and provide roster search, progress filters, sorting, and incremental display. Completion state follows both the account and the list.
- Saved: share saved IDs across cards, guard account changes and stale requests, and retain an explicit guest save intent through sign-in.
- Trips: use one user-facing name across existing URLs, clearer collection groups and thumbnails, route/place prefills, owner-aware party choices, and recoverable load errors. Totals use route traversal metrics and state that linked routes may overlap. Missing linked rows remain errors.
- Shared trips: let visitors start a similar trip from visible catalog routes and places. Private tracks, notes, dates, party members, and health data are not copied.
- Log and imports: use compact summaries, activity thumbnails, month groups, clearer actions, and a GPX map preview.
- Reports: share one create/edit flow with ordered photo uploads, preview, visibility, and retry states. Public reports expose full photos; destination report indexes paginate.
- Account and admin pages: keep errors visible, provide load recovery, preserve edits after failed saves, and replace native alerts with inline feedback. Request guards prevent stale results from replacing newer searches.

## Verification

- Production Next.js build, TypeScript, and ESLint pass.
- Full web test suite: 486 passed, zero failed or skipped.
- Read-only catalog checks covered text, state, route distance/gain/effort, nearby search, punctuation, paging, list reads, and selected-area geometry. All 66 Washington routes appeared once across six pages.
- Browser checks covered 320, 390, 768, 1280, and 1440 pixel widths in the host's dark appearance. Checked home, Features, hiking, Discover, areas, lists, destination and route details, selected-area Map, guest Save, and route planning through sign-in. Checked pages had no horizontal overflow.
- Search returned 16 Rainier matches with continuation. California area page two returned results 13–24 of 614; selecting Angel Island retained the state, type, and page on Map. Washington area pagination returned a distinct next page.

## Remaining acceptance and owner decision

Signed-in writes, uploads, account switching, and admin mutations have code and focused test coverage, but were not exercised against production accounts in the browser. No test database was configured. A signed-in acceptance pass and visual check in light appearance remain before release.

The Terms page still contains its existing governing-law placeholder. The owner must choose the jurisdiction; this change does not invent or alter that legal clause.

## Operations

No schema migration, infrastructure configuration, deployment, or new service is included. Fixed infrastructure cost change: $0/month. Catalog reads and image delivery use existing services; request volume may change with use. Local database smoke checks enforced read-only transactions. Local credentials and build output are excluded from the commit.
