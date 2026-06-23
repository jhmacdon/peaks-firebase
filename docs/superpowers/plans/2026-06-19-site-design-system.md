# Site-wide design system rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the destination/route detail-page visual language (flat surfaces, gray hairlines, capped radii, color as outlined pills) to the rest of the user-facing web app, killing the gradient/glow card aesthetic.

**Architecture:** Extract a small set of shared UI primitives (`Card`, `Badge`, `PageHeader`, `SectionHeading`, `EmptyState`) into `web/src/components/ui/`, rewrite the four entity cards + the search bar on top of them, then restyle page-level chrome (discover, map, login, register) in place against fixed Tailwind tokens. Most other pages are already compliant and only need an audit pass.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4. Dark mode via OS `prefers-color-scheme` (`dark:` variants).

**Spec:** [`web/docs/design-system-spec.md`](../../../web/docs/design-system-spec.md) — the source of truth for every token below.

## Global Constraints

- **Tailwind tokens (verbatim from spec):**
  - Page bg `bg-white dark:bg-gray-950`; card/panel bg `bg-white dark:bg-gray-900`.
  - Hairline `border-gray-200 dark:border-gray-800`; hover `hover:border-gray-300 dark:hover:border-gray-700`.
  - Radius capped at `rounded-lg` (cards/panels/inputs), `rounded-md` (buttons), `rounded-full` (pills only).
  - **Banned everywhere in scope:** `bg-gradient-*`, `linear-gradient`, `radial-gradient`, `rounded-2xl`, `rounded-3xl`, arbitrary `rounded-[…]`, `shadow-md/lg/xl/2xl`, arbitrary `shadow-[…]`, `hover:-translate-y-*`, `transition-all`, `stone-*`, `slate-*`, decorative eyebrows (`uppercase tracking-[0.18em]`/`tracking-[0.2em]`/`tracking-[0.22em]`).
  - **Allowed exception:** floating overlays (dropdowns, popovers, map control panels, modals) may use a single functional `shadow-sm` (`shadow-md` for modals). Restrained labels using `uppercase tracking-wide` (e.g. `SidePanel` header, `block-editor` label) are allowed and stay.
  - Primary action/link color is `blue-600` (hover `blue-700`, `dark:text-blue-400`) — independent of category color.
  - Per-type accent (outlined pills only): destination=emerald, route=sky, list=amber, trip report=gray. Difficulty: Easy=emerald, Moderate=sky, Hard=amber, Strenuous=red.
- **Primary button class (verbatim):** `inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700`
- **Secondary button class (verbatim):** `inline-flex items-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800`
- **Out of scope (do not touch):** `web/src/app/admin/**`, `components/admin-nav.tsx`, `lib/seo-image.tsx`, `app/opengraph-image.tsx`, `app/twitter-image.tsx`, and the Leaflet `*-map.tsx` components' internals.
- **Verification model:** presentational Tailwind components have no meaningful unit tests, so the per-task cycle is **build + lint + guard-grep + visual**, not Jest. The project mandates build+lint passing (`web/CLAUDE.md`).
  - Build: `cd web && npm run build`
  - Lint: `cd web && npm run lint` (zero errors; pre-existing `<img>` warnings OK)
  - Guard-grep (run from `web/src`, per touched file): `grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" <file>` → expect **no output** (except documented overlay `shadow-sm/md`, noted per task).
- **Commits:** one per task, on the current branch (`claude/focused-carson-ccf604`).
- **React hooks:** preserve all existing `useEffect`/state logic in pages and the search bar untouched — these tasks change JSX/classes only. Do not alter dependency arrays (see `web/CLAUDE.md` useEffect rules).

---

### Task 1: `Badge` primitive

**Files:**
- Create: `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/index.ts`

**Interfaces:**
- Produces: `Badge` (React component, props `{ tone?: BadgeTone; className?: string; children: React.ReactNode }`), `type BadgeTone = "emerald" | "sky" | "amber" | "gray" | "red"`.

- [ ] **Step 1: Create `web/src/components/ui/badge.tsx`**

```tsx
type BadgeTone = "emerald" | "sky" | "amber" | "gray" | "red";

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  gray: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
};

export function Badge({
  tone = "gray",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export type { BadgeTone };
```

- [ ] **Step 2: Create `web/src/components/ui/index.ts`**

```tsx
export { Badge, type BadgeTone } from "./badge";
```

- [ ] **Step 3: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS, zero errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui/badge.tsx web/src/components/ui/index.ts
git commit -m "feat(web): add Badge ui primitive (outlined pill)"
```

---

### Task 2: `Card` primitive

**Files:**
- Create: `web/src/components/ui/card.tsx`
- Modify: `web/src/components/ui/index.ts`

**Interfaces:**
- Produces: `Card` (props `{ href?: string; className?: string; children: React.ReactNode }`). Renders a `<Link>` with a `group` class when `href` is set, otherwise a `<div>`.

- [ ] **Step 1: Create `web/src/components/ui/card.tsx`**

```tsx
import Link from "next/link";

const BASE =
  "block rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700";

export function Card({
  href,
  className = "",
  children,
}: {
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `${BASE} ${className}`.trim();
  if (href) {
    return (
      <Link href={href} className={`group ${cls}`}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}
```

- [ ] **Step 2: Re-export from `web/src/components/ui/index.ts`**

Add line:

```tsx
export { Card } from "./card";
```

- [ ] **Step 3: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui/card.tsx web/src/components/ui/index.ts
git commit -m "feat(web): add Card ui primitive (flat shell)"
```

---

### Task 3: `PageHeader`, `SectionHeading`, `EmptyState` primitives

**Files:**
- Create: `web/src/components/ui/page-header.tsx`
- Create: `web/src/components/ui/section-heading.tsx`
- Create: `web/src/components/ui/empty-state.tsx`
- Modify: `web/src/components/ui/index.ts`

**Interfaces:**
- Produces:
  - `PageHeader` props `{ title: string; meta?: React.ReactNode; actions?: React.ReactNode; className?: string }`
  - `SectionHeading` props `{ title: string; action?: React.ReactNode; className?: string }`
  - `EmptyState` props `{ children: React.ReactNode; className?: string }`

- [ ] **Step 1: Create `web/src/components/ui/page-header.tsx`**

```tsx
export function PageHeader({
  title,
  meta,
  actions,
  className = "",
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${className}`.trim()}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        {meta && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ui/section-heading.tsx`**

```tsx
export function SectionHeading({
  title,
  action,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`.trim()}>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
      {action}
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/components/ui/empty-state.tsx`**

```tsx
export function EmptyState({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Re-export from `web/src/components/ui/index.ts`**

Add lines:

```tsx
export { PageHeader } from "./page-header";
export { SectionHeading } from "./section-heading";
export { EmptyState } from "./empty-state";
```

- [ ] **Step 5: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/page-header.tsx web/src/components/ui/section-heading.tsx web/src/components/ui/empty-state.tsx web/src/components/ui/index.ts
git commit -m "feat(web): add PageHeader, SectionHeading, EmptyState primitives"
```

---

### Task 4: Outlined difficulty pills

**Files:**
- Modify: `web/src/components/detail-sections.tsx:6-23` (`DIFFICULTY_CLASSES` + `DifficultyPill`)

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged exports `DIFFICULTY_CLASSES` and `DifficultyPill` (signatures identical; only classes change). No external importer of `DIFFICULTY_CLASSES` exists (verified), so this is safe.

- [ ] **Step 1: Replace `DIFFICULTY_CLASSES` and `DifficultyPill`**

Replace lines 6-23 with:

```tsx
export const DIFFICULTY_CLASSES: Record<string, string> = {
  Easy: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  Moderate: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300",
  Hard: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  Strenuous: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
};

export function DifficultyPill({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        DIFFICULTY_CLASSES[label] || DIFFICULTY_CLASSES.Moderate
      }`}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/detail-sections.tsx`
Expected: build/lint PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/destinations/<id>` and `/routes/<id>` (light + dark). Difficulty pills now render as outlined chips; layout otherwise unchanged.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/detail-sections.tsx
git commit -m "refactor(web): outlined difficulty pills to match design system"
```

---

### Task 5: Rewrite `DestinationCard`

**Files:**
- Modify (full rewrite): `web/src/components/destination-card.tsx`

**Interfaces:**
- Consumes: `Card` (Task 2), `Badge` (Task 1).
- Produces: default-exported `DestinationCard` with unchanged props `{ id: string; name: string | null; elevation: number | null; features: string[]; distance_m?: number }`.

- [ ] **Step 1: Replace the whole file**

```tsx
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

interface DestinationCardProps {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  distance_m?: number;
}

export default function DestinationCard({
  id,
  name,
  elevation,
  features,
  distance_m,
}: DestinationCardProps) {
  const visibleFeatures = features.slice(0, 3);
  const hiddenFeatureCount = Math.max(0, features.length - visibleFeatures.length);
  const elevationFeet =
    elevation != null
      ? `${Math.round(elevation * 3.28084).toLocaleString()} ft`
      : "Unknown";
  const distanceLabel =
    distance_m == null
      ? null
      : distance_m < 1609.34
        ? `${Math.round(distance_m)} m away`
        : `${(distance_m / 1609.34).toFixed(1)} mi away`;
  const meta = [elevationFeet, distanceLabel].filter(Boolean).join(" · ");

  return (
    <Card href={`/destinations/${id}`} className="h-full">
      <div className="text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {name || "Unnamed"}
      </div>
      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{meta}</div>
      {visibleFeatures.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleFeatures.map((feature, i) => (
            <Badge key={feature} tone={i === 0 ? "emerald" : "gray"}>
              {feature}
            </Badge>
          ))}
          {hiddenFeatureCount > 0 && <Badge tone="gray">+{hiddenFeatureCount} more</Badge>}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/destination-card.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/discover` (popular destinations grid), light + dark. Cards are flat with a gray border, name turns blue on hover, first feature pill emerald, rest gray.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/destination-card.tsx
git commit -m "refactor(web): flatten DestinationCard onto Card + Badge"
```

---

### Task 6: Rewrite `RouteCard`

**Files:**
- Modify (full rewrite): `web/src/components/route-card.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `DifficultyPill` (from `./detail-sections`), and existing helpers from `../lib/route-guide` (`describeRouteShape`, `describeCompletionMode`, `formatDistanceMeters`, `formatElevationMeters`, `summarizeRouteGuide`).
- Produces: default-exported `RouteCard` with unchanged props `{ route: SearchRouteResult }`.

- [ ] **Step 1: Replace the whole file**

```tsx
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { DifficultyPill } from "./detail-sections";
import type { SearchRouteResult } from "../lib/actions/search";
import {
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
  summarizeRouteGuide,
} from "../lib/route-guide";

interface RouteCardProps {
  route: SearchRouteResult;
}

export default function RouteCard({ route }: RouteCardProps) {
  const summary = summarizeRouteGuide({ ...route, gain_loss: null });

  return (
    <Card href={`/routes/${route.id}`} className="h-full">
      <div className="text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {route.name || "Unnamed route"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <DifficultyPill label={summary.difficultyLabel} />
        <Badge tone="sky">{describeRouteShape(route.shape)}</Badge>
        <Badge tone="gray">
          {route.destination_count} stop{route.destination_count === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800">
        <RouteMetric label="Distance" value={formatDistanceMeters(route.distance)} />
        <RouteMetric label="Gain" value={formatElevationMeters(route.gain)} />
        <RouteMetric
          label="Beta"
          value={
            route.session_count === 0
              ? "New"
              : `${route.session_count} log${route.session_count === 1 ? "" : "s"}`
          }
        />
      </div>
    </Card>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-2 dark:bg-gray-900">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/route-card.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/discover` (featured routes), light + dark. Flat card, difficulty pill outlined, sky shape pill, ruled 3-cell metric strip.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/route-card.tsx
git commit -m "refactor(web): flatten RouteCard onto Card + Badge"
```

---

### Task 7: Rewrite `ListCard`

**Files:**
- Modify (full rewrite): `web/src/components/list-card.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `ListRow` type from `../lib/actions/lists`.
- Produces: default-exported `ListCard` with unchanged props `{ list: ListRow }`.

- [ ] **Step 1: Replace the whole file**

```tsx
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { ListRow } from "../lib/actions/lists";

interface ListCardProps {
  list: ListRow;
}

export default function ListCard({ list }: ListCardProps) {
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";
  const description =
    list.description || "A public checklist for planning, progress, and route research.";

  return (
    <Card href={`/lists/${list.id}`} className="h-full">
      <Badge tone="amber">{ownerLabel}</Badge>
      <div className="mt-2 text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {list.name}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
        {description}
      </p>
      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-white">
          {list.destination_count}
        </span>{" "}
        destination{list.destination_count === 1 ? "" : "s"}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/list-card.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/discover` (browse lists) and `/lists`, light + dark. Flat card, amber owner pill.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/list-card.tsx
git commit -m "refactor(web): flatten ListCard onto Card + Badge"
```

---

### Task 8: Rewrite `TripReportCard`

**Files:**
- Modify (full rewrite): `web/src/components/trip-report-card.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `TripReport` type from `../lib/actions/trip-reports`.
- Produces: default-exported `TripReportCard` with unchanged props `{ report: TripReport }`.

- [ ] **Step 1: Replace the whole file**

```tsx
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { TripReport } from "../lib/actions/trip-reports";

interface TripReportCardProps {
  report: TripReport;
}

export default function TripReportCard({ report }: TripReportCardProps) {
  const date = new Date(report.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const photoCount = report.blocks.filter((block) => block.type === "photo").length;
  const destinationCount = report.destinations.length;
  const firstTextBlock = report.blocks.find((b) => b.type === "text");
  const preview = firstTextBlock?.content
    ? firstTextBlock.content.length > 200
      ? firstTextBlock.content.slice(0, 200) + "..."
      : firstTextBlock.content
    : null;

  return (
    <Card href={`/reports/${report.id}`} className="h-full">
      <Badge tone="gray">Field report</Badge>
      <div className="mt-2 text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {report.title}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {report.userName} · {date}
      </div>
      {preview && (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
          {preview}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="gray">
          {destinationCount} destination{destinationCount === 1 ? "" : "s"}
        </Badge>
        <Badge tone="sky">
          {photoCount} photo{photoCount === 1 ? "" : "s"}
        </Badge>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/trip-report-card.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/discover` (recent reports), light + dark. Flat card, neutral "Field report" pill.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/trip-report-card.tsx
git commit -m "refactor(web): flatten TripReportCard onto Card + Badge"
```

---

### Task 9: Restyle `SearchBar`

**Files:**
- Modify: `web/src/components/search-bar.tsx:78-129` (the returned JSX only — keep all hooks/state above untouched)

**Interfaces:**
- Consumes: nothing new. Props and behavior unchanged (`{ placeholder?: string; paramName?: string }`).

- [ ] **Step 1: Replace the `return (...)` block (lines 78-129)**

```tsx
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-md border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-[15px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:hover:border-gray-600"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            updateSearch("");
          }}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="Clear search"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
```

- [ ] **Step 2: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/search-bar.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 3: Visual check**

Load `/discover`. Single bordered input with inline gray search icon and blue focus ring; typing still updates the URL (debounced); clear button works.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/search-bar.tsx
git commit -m "refactor(web): flatten SearchBar to bordered input"
```

---

### Task 10: Restyle `discover` page chrome

**Files:**
- Modify: `web/src/app/(public)/discover/page.tsx`

**Interfaces:**
- Consumes: `EmptyState`, `SectionHeading` (Task 3); existing imports stay.

This page keeps all logic and structure; only classes/markup of presentational chrome change. Work in these sub-steps.

- [ ] **Step 1: Add imports**

After the existing component imports near the top, add:

```tsx
import { EmptyState } from "../../../components/ui/empty-state";
import { SectionHeading } from "../../../components/ui/section-heading";
```

- [ ] **Step 2: Replace the hero `<section>` (currently lines ~337-471)**

Replace the entire `<section className="overflow-hidden rounded-[32px] …"> … </section>` block with:

```tsx
      <section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              Search like a trail planner, not a landing page.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-400">
              Find peaks, trailheads, shelters, route guides, and curated lists.
              Start from a name, jump straight to the map, or browse what people
              are actually climbing right now.
            </p>
            <div className="mt-5 max-w-3xl">
              <SearchBar placeholder="Search peaks, trailheads, routes, and lists" />
            </div>

            {query ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {searchScopeOptions.map((scope) => (
                  <Link
                    key={scope.id}
                    href={buildDiscoverHref({ nextScope: scope.id })}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      searchScope === scope.id
                        ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    }`}
                  >
                    {scope.label} <span className="ml-1 opacity-70">{scope.count}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="#nearby" className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                  Nearby objectives
                </Link>
                <Link href="#featured-routes" className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                  Featured routes
                </Link>
                <Link href="/lists" className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                  Curated lists
                </Link>
                <Link href="#recent-reports" className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                  Recent field notes
                </Link>
              </div>
            )}

            {popularSearches.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Popular searches
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {popularSearches.map((term) => (
                    <Link
                      key={term}
                      href={buildDiscoverHref({ nextQuery: term, nextScope: null })}
                      className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      {term}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={mapHref} className="inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                Open map explorer
              </Link>
              <Link href={user ? "/plans/new" : "/register"} className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                {user ? "Build a trip plan" : "Create an account"}
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <aside className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Browse the catalog
              </div>
              <div className="mt-4 space-y-4">
                <CatalogStat label="Destination guides" value={stats.destinationCount.toLocaleString("en-US")} detail="Peaks, trailheads, shelters, and mapped objectives" />
                <CatalogStat label="Published routes" value={stats.routeCount.toLocaleString("en-US")} detail="Distance, gain, shape, and map-ready route pages" />
                <CatalogStat label="Curated lists" value={stats.listCount.toLocaleString("en-US")} detail="Peak-bagging collections and planning checklists" />
              </div>
            </aside>

            <aside className="rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Better starting points
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                <p>Use search when you already know the objective.</p>
                <p>Use the map when you want nearby options and terrain context.</p>
                <p>Use lists when you are planning a progression or peak-bagging goal.</p>
              </div>
            </aside>
          </div>
        </div>
      </section>
```

- [ ] **Step 3: Restyle the search-results header card (currently the `rounded-[28px] … shadow-sm` div inside the `query ?` branch)**

Change its wrapper class from `rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900` to:

```
rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900
```

Inside it: change the eyebrow `text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400` to `text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400`; change the `<h2>` color `text-stone-950` → `text-gray-900`; change the description `text-stone-500` → `text-gray-500`; change the "Open on the map" link `text-emerald-700 hover:text-emerald-800 dark:text-emerald-400` → `text-blue-600 hover:text-blue-700 dark:text-blue-400`; change "Clear search" `text-stone-600 hover:text-stone-900 … ` → `text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white`.

- [ ] **Step 4: Restyle the "Best matches" tiles**

Change each best-match `<Link>` wrapper from `rounded-[24px] border border-stone-200 bg-stone-50 px-5 py-4 … hover:border-stone-300 hover:bg-white …` to:

```
group block rounded-lg border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700
```

Inside: eyebrow `text-[11px] … tracking-[0.22em] text-stone-500` → `text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400`; title `text-stone-950 group-hover:text-emerald-800 dark:group-hover:text-emerald-300` → `text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300`; summary `text-stone-600` → `text-gray-600 dark:text-gray-300`.

- [ ] **Step 5: Replace the no-results panel and the five section empty states with `EmptyState`**

The no-results block (currently `rounded-[28px] border border-dashed border-stone-300 …`) becomes:

```tsx
<EmptyState className="border-dashed py-8">
  <div className="text-lg font-semibold text-gray-900 dark:text-white">
    No matches for &ldquo;{query}&rdquo; in this view.
  </div>
  <p className="mt-2 text-gray-500 dark:text-gray-400">
    Try a broader search, switch result types, or start from one of the popular objectives below.
  </p>
  {popularSearches.length > 0 && (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {popularSearches.map((term) => (
        <Link
          key={term}
          href={buildDiscoverHref({ nextQuery: term, nextScope: null })}
          className="rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {term}
        </Link>
      ))}
    </div>
  )}
</EmptyState>
```

The five list empty states (currently `rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm …` with messages "Requesting your location...", "No destinations found nearby", "No popular destinations yet", "No published routes yet", "No lists available", "No public trip reports yet") each become `<EmptyState>message</EmptyState>`.

- [ ] **Step 6: Drop the section eyebrows**

For each browse section (Nearby, Popular destinations, Featured routes, Browse lists, Recent trip reports), remove the `<div className="text-[11px] font-semibold uppercase tracking-[0.22em] …">…</div>` eyebrow line that sits above the `<h2>`. Leave the `<h2 className="… text-2xl font-semibold tracking-tight">` and its description/action link. Where a section has a right-aligned action link, change its color from `text-emerald-700 … dark:text-emerald-400` to `text-blue-600 hover:text-blue-700 dark:text-blue-400`.

- [ ] **Step 7: Rewrite the three helper components at the bottom of the file**

Replace `CatalogStat`, `QuickBrowseCard`, and `SearchSection` with:

```tsx
function CatalogStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
        {value}
      </div>
      <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">{detail}</p>
    </div>
  );
}

function QuickBrowseCard({
  href,
  eyebrow,
  title,
  detail,
}: {
  href: string;
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {eyebrow}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {title}
      </div>
      <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">{detail}</p>
    </Link>
  );
}

function SearchSection({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {title} ({count})
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 8: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" "app/(public)/discover/page.tsx"`
Expected: PASS; grep returns nothing.

- [ ] **Step 9: Visual check**

Load `/discover` empty and with a search `?q=rainier`, light + dark. No gradient hero, flat catalog/tips panels, flat scope chips, blue CTA, flat empty states, plain section headings (no eyebrows), blue action links.

- [ ] **Step 10: Commit**

```bash
git add "web/src/app/(public)/discover/page.tsx"
git commit -m "refactor(web): flatten discover page chrome"
```

---

### Task 11: Restyle `map` page chrome

**Files:**
- Modify: `web/src/app/(public)/map/page.tsx` (lines 103, 104, 142, 143, 149, 155, 222, 243, 244, 255)

**Interfaces:** none new. Map component internals untouched.

These panels are floating overlays on the map, so a functional `shadow-sm` is allowed (the guard-grep will be run with that exception noted).

- [ ] **Step 1: Flatten the three overlay panels (lines 103, 142, 243)**

In each, replace `rounded-[28px] border border-white/70 bg-white/92 p-5 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/92` with:

```
rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900
```

- [ ] **Step 2: Tame the three eyebrows (lines 104, 143, 244)**

Replace `text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300` (line 104) and `text-xs font-semibold uppercase tracking-[0.2em] text-gray-500` (lines 143, 244) with the restrained label style, keeping their respective colors:
- line 104 → `text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300`
- lines 143, 244 → `text-xs font-semibold uppercase tracking-wide text-gray-500`

- [ ] **Step 3: Fix the rounded buttons / cards (lines 149, 155, 222, 255)**

- Line 149: `rounded-2xl bg-blue-600 …` → `rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700`
- Line 155: `rounded-2xl border border-gray-300 …` → change only `rounded-2xl` to `rounded-md` (keep the rest).
- Line 222: `rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/60` → `rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900`
- Line 255: `block rounded-2xl border border-gray-200 bg-white px-4 py-3 …` → change only `rounded-2xl` to `rounded-lg` (keep hover styles).

Note line 223 (`uppercase tracking-wide`) is the allowed restrained label — leave it.

- [ ] **Step 4: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" "app/(public)/map/page.tsx"`
Expected: PASS; grep shows **only** the three `shadow-sm` overlay lines (103, 142, 243) — allowed exception — and nothing else.

- [ ] **Step 5: Visual check**

Load `/map`, light + dark. Overlay panels are flat with a subtle shadow and `rounded-lg`; buttons `rounded-md`; result rows `rounded-lg`.

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/(public)/map/page.tsx"
git commit -m "refactor(web): flatten map page overlay chrome"
```

---

### Task 12: Restyle `login` and `register` pages

**Files:**
- Modify: `web/src/app/login/page.tsx`
- Modify: `web/src/app/register/page.tsx`

**Interfaces:** none new. All hooks/handlers untouched; class/markup edits only.

Apply the identical set of edits to both files (they share structure).

- [ ] **Step 1: Flatten the page background**

`login` line 103: replace `min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_30%),linear-gradient(180deg,_#f8fafc,_#eef2ff_40%,_#f8fafc)] dark:bg-gray-950` with `min-h-screen bg-gray-50 dark:bg-gray-950`.
`register` line 87: replace `min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ecfeff_45%,_#f8fafc)] dark:bg-gray-950` with `min-h-screen bg-gray-50 dark:bg-gray-950`.

- [ ] **Step 2: Flatten the eyebrow pill**

`login` line 106: replace `inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-4 py-1.5 text-sm text-blue-700 shadow-sm backdrop-blur dark:border-blue-900 dark:bg-gray-900/80 dark:text-blue-300` with `inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300`.
`register` line 90: same treatment but keep cyan→change to blue for consistency: `inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300`.

- [ ] **Step 3: Flatten the feature cards**

`login` line 126 / `register` line 110: replace `rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80` with `rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900`.

- [ ] **Step 4: Flatten the form card**

`login` line 139 / `register` line 123: replace `w-full rounded-[28px] border border-white/70 bg-white/90 p-8 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/90` with `w-full rounded-lg border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900`.

- [ ] **Step 5: Fix input/button radii**

In both files, change every `rounded-xl` on the OAuth buttons, the email/name/password inputs, the error/reset message boxes, and the submit button to `rounded-md`. (login: lines 150, 174, 201, 220, 226, 232, 240; register: lines 134, 146, 171, 181, 191, 201, 209. Apply to all `rounded-xl` occurrences in each file.)

- [ ] **Step 6: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(md|lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" app/login/page.tsx app/register/page.tsx`
Expected: PASS; grep returns nothing.

- [ ] **Step 7: Visual check**

Load `/login` and `/register`, light + dark. Flat gray page, flat bordered form card, `rounded-md` inputs/buttons; OAuth + email flows visually intact.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/login/page.tsx web/src/app/register/page.tsx
git commit -m "refactor(web): flatten login and register pages"
```

---

### Task 13: Minor component cleanups

**Files:**
- Modify: `web/src/components/route-external-links.tsx:16,24`
- Modify: `web/src/components/route-segment-list.tsx:42`
- Modify: `web/src/components/app-nav.tsx:75`
- Modify: `web/src/components/destination-picker.tsx:127`
- Modify: `web/src/components/route-picker.tsx:123`
- Modify: `web/src/components/user-popover.tsx:50`
- Modify: `web/src/app/(authenticated)/reports/new/page.tsx:244`

**Interfaces:** none new.

- [ ] **Step 1: `route-external-links.tsx`**

Line 16: change `rounded-2xl` → `rounded-lg`. Line 24: remove `transition-transform group-hover:translate-x-0.5` (keep the rest of the span's classes, i.e. `text-xs font-medium text-blue-600 dark:text-blue-400`).

- [ ] **Step 2: `route-segment-list.tsx`**

Line 42: change `rounded-2xl` → `rounded-lg`. (Line 63's `uppercase tracking-wide` pill is the allowed restrained label — leave it.)

- [ ] **Step 3: `app-nav.tsx`**

Line 75: change the "Create Account" button `rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700` → `rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700`.

- [ ] **Step 4: Overlay shadows (allowed exception → normalize to `shadow-md`)**

These are floating dropdowns/popovers; keep a functional shadow but normalize `shadow-lg` → `shadow-md`:
- `destination-picker.tsx:127` `shadow-lg` → `shadow-md`
- `route-picker.tsx:123` `shadow-lg` → `shadow-md`
- `user-popover.tsx:50` `rounded-xl … shadow-lg` → `rounded-lg … shadow-md`
- `reports/new/page.tsx:244` `shadow-lg` → `shadow-md`

- [ ] **Step 5: Build + lint + guard-grep**

Run: `cd web && npm run build && npm run lint`
Run: `cd web/src && grep -nE "gradient|rounded-(2xl|3xl|\[)|shadow-(lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" components/route-external-links.tsx components/route-segment-list.tsx components/app-nav.tsx components/destination-picker.tsx components/route-picker.tsx components/user-popover.tsx "app/(authenticated)/reports/new/page.tsx"`
Expected: PASS; grep returns nothing (note the grep here excludes `shadow-md`, which is the allowed overlay value).

- [ ] **Step 6: Visual check**

Open the destination picker and route picker dropdowns (e.g. on `/plans/new`), the user popover (admin nav is out of scope — check `user-popover` only where used), and `/reports/new`. Menus float with a subtle shadow and `rounded-lg`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/route-external-links.tsx web/src/components/route-segment-list.tsx web/src/components/app-nav.tsx web/src/components/destination-picker.tsx web/src/components/route-picker.tsx web/src/components/user-popover.tsx "web/src/app/(authenticated)/reports/new/page.tsx"
git commit -m "refactor(web): minor design-system cleanups (radii, overlay shadows, nav button)"
```

---

### Task 14: Audit already-clean pages

**Files (read/verify; edit only if a violation is found):**
`app/(public)/lists/page.tsx`, `app/(public)/lists/[id]/page.tsx`, `app/(public)/reports/[id]/page.tsx`, `app/(public)/destinations/[id]/reports/page.tsx`, `app/(authenticated)/log/page.tsx`, `app/(authenticated)/log/[id]/page.tsx`, `app/(authenticated)/plans/page.tsx`, `app/(authenticated)/plans/new/page.tsx`, `app/(authenticated)/plans/[id]/page.tsx`, `app/(authenticated)/account/page.tsx`, `app/(authenticated)/account/profile/page.tsx`, `app/(authenticated)/account/friends/page.tsx`, and components `stats-banner.tsx`, `progress-bar.tsx`, `plan-card.tsx`, `session-card.tsx`, `friend-card.tsx`.

**Interfaces:** none. These already render the new shared cards and use gray/`rounded-lg`/`blue-600`.

- [ ] **Step 1: Guard-grep the whole in-scope tree**

Run from `web/src`:

```bash
grep -rnE "gradient|rounded-(2xl|3xl|\[)|shadow-(lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" \
  "app/(public)" "app/(authenticated)" app/login app/register components \
  | grep -v "components/admin-nav.tsx"
```

Expected: **no output**. (Overlay `shadow-md` is intentionally excluded from this grep.)

- [ ] **Step 2: If any line is reported, fix it in place**

Apply the same token rules (gradient→flat, big radius→`rounded-lg`/`-md`, decorative shadow→remove or overlay `shadow-sm/md`, `stone/slate`→`gray`, `tracking-[0…]`→`tracking-wide` or drop). If output was empty, no edits — continue.

- [ ] **Step 3: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Visual spot-check**

Load `/lists`, `/lists/<id>`, `/reports/<id>`, `/log`, `/plans`, `/account`, light + dark. Confirm the new flat cards render and nothing regressed.

- [ ] **Step 5: Commit (only if edits were made)**

```bash
git add -A web/src
git commit -m "refactor(web): tidy residual design-system violations on clean pages"
```

If no edits were needed, skip the commit and note "audit clean" in the task log.

---

### Task 15: Final full verification

**Files:** none.

- [ ] **Step 1: Full build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS, zero errors (pre-existing `<img>` warnings OK).

- [ ] **Step 2: Full guard-grep**

Run from `web/src`:

```bash
grep -rnE "gradient|rounded-(2xl|3xl|\[)|shadow-(lg|xl|2xl|\[)|stone-|slate-|tracking-\[0" \
  "app/(public)" "app/(authenticated)" app/login app/register components \
  | grep -v "components/admin-nav.tsx"
```

Expected: **no output**.

- [ ] **Step 3: Dark-mode + light-mode walkthrough**

Visit every restyled surface in both modes: `/discover` (empty + `?q=`), `/map`, `/lists`, `/lists/<id>`, `/destinations/<id>` (reference unchanged + outlined difficulty pills), `/routes/<id>`, `/reports/<id>`, `/login`, `/register`, `/log`, `/plans`, `/account`. Confirm: no gradients/glows, capped radii, outlined pills legible in both modes, `blue-600` actions, cards flat with gray borders.

- [ ] **Step 4: Confirm admin untouched**

Run: `cd web/src && git diff --name-only main -- app/admin | head`
Expected: no admin files changed.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Foundations/surfaces/borders/radius/shadow tokens → enforced by guard-grep in every task + Tasks 5-14.
- Per-type accent palette + outlined pills → `Badge` (Task 1), applied in Tasks 5-8.
- Outlined difficulty pills → Task 4.
- Typography / eyebrow ban → `PageHeader`/`SectionHeading` (Task 3), discover (Task 10), map (Task 11).
- Shared primitives (`Card`, `Badge`, `PageHeader`, `SectionHeading`, `EmptyState`) → Tasks 1-3.
- Card content by type → Tasks 5-8. SearchBar → Task 9.
- Application map (gradient offenders, chrome restyles, minor cleanups, clean-page audit) → Tasks 5-14.
- Out-of-scope (admin/OG/maps) → Global Constraints + Task 15 Step 4.
- Verification → per-task build/lint/grep + Task 15.

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; every code step ships complete code or exact before→after class strings.

**3. Type consistency** — `Card`/`Badge`/`BadgeTone`/`PageHeader`/`SectionHeading`/`EmptyState` signatures defined in Tasks 1-3 are used with those exact names/props in Tasks 5-10. Card props use `href`/`className`/`children` consistently; `Badge` `tone` values are the same five everywhere.
