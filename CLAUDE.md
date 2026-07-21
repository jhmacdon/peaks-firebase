# Peaks Firebase

## Project Structure
- `functions/` — Firebase Cloud Functions (TypeScript, compiled to `functions/lib/`)
- `functions/src/` — Source files
- `firestore.rules` — Firestore security rules
- `firebase.json` — Firebase project configuration

## Build & Lint
After making changes, always verify the affected project compiles and lints cleanly before finishing:

**Functions:**
```bash
cd functions && npm run build && npm run lint
```
- **Build**: `npm run build` (runs `tsc`)
- **Lint**: `npm run lint` (runs `eslint --ext .js,.ts .`)
- Lint must pass with zero errors. Warnings for unused `context` params in Firebase function signatures are acceptable.

**Web:**
```bash
cd web && npm run build && npm run lint
```
- **Build**: `npm run build` (runs `next build`)
- **Lint**: `npm run lint` (runs `eslint`)
- Both must pass with zero errors before considering work complete. Pre-existing warnings (e.g. `<img>` vs `<Image />`) are acceptable.

## Deployment
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`) — deploys on push to `main`
  - `deploy-functions` job: builds + deploys Cloud Functions and Firestore rules
  - `deploy-api` job: builds + deploys Cloud Run API (`cloud-sql/api`) via multi-stage Dockerfile
- Deploy uses `--force` to auto-delete stale functions removed from source
- Service account credentials: stored as `FIREBASE_SERVICE_ACCOUNT` GitHub secret
- `firebase.ts` uses application default credentials in CI (falls back when `admin-service-account.json` is absent)

**After every `git push`**: monitor the triggered workflow run with `gh run list --limit 1` and `gh run watch <id>`. If a job fails, check logs with `gh run view <id> --log-failed`, fix the issue, and push again. Do not consider a push complete until CI is green.

**Cloud Run secrets/env vars**: All required env vars and secrets for the Cloud Run API are pinned in `deploy.yml`. **NEVER use `gcloud run services update --set-secrets` or `--set-env-vars`** — these flags REPLACE all existing values, silently dropping any not listed. Instead, update the `env_vars` and `secrets` fields in `deploy.yml` and redeploy via CI. The post-deploy verification step will catch DB connectivity failures.

## Infrastructure cost discipline

Baseline: the entire backend should run at **~$10–15/month** (Cloud SQL `db-f1-micro` ~$10 + request-billed Cloud Run + free-tier scheduler). Any design or config change that raises that floor must state an explicit **$/month estimate** in the PR or commit message, and the cheaper alternative must be shown to lose real user-visible value before being rejected. When two designs deliver the same user value, ship the cheaper one — always.

**Cloud Run rules (peaks-api and every service):**
- Stay scale-to-zero and CPU-throttled: `--min-instances=0 --cpu-throttling` (request-based billing). These are pinned in `deploy.yml`.
- **Never** set `--no-cpu-throttling` or `min-instances>0` without pricing it first. The math: one always-allocated vCPU ≈ **$47/mo**, 512Mi always-on ≈ $2.6/mo — an idle min instance with always-on CPU costs **~$50/mo before serving a single request**. This exact mistake shipped in July 2026: an in-process sweep `setInterval` "needed" background CPU, and the $10/mo forecast silently became $70/mo.
- Background/periodic work must run **inside a request**, never on an in-process timer. Cloud Run timers either silently starve (throttled CPU between requests) or force always-on CPU (expensive) — both are wrong. The pattern that replaced the timer: Cloud Scheduler job (`peaks-api-sweep`, free tier covers 3 jobs) → OIDC-authenticated `POST /internal/sweep`; the scheduler request itself provides the CPU window.
- Prefer free-tier managed primitives (Cloud Scheduler, Cloud Tasks, Pub/Sub at this scale) over resident compute; prefer piggybacking work on existing request handlers over new infrastructure.
- Fire-and-forget async work after `res.json()` (e.g. Slack notifies) is best-effort under throttling — anything that must reliably complete belongs in the request path or the sweep.
- Cost-relevant flags live ONLY in `deploy.yml` — a manual `gcloud run services update` will be overwritten by the next CI deploy. Drift check: `gcloud run services describe peaks-api --region us-central1 | grep -E "minScale|cpu-throttling"`.
- The ~35 Firebase-function services scale to zero by default — keep it that way; never give one min instances to "warm it up" without pricing it.

**Cloud SQL:** `db-f1-micro` is the floor (~$10/mo). A tier bump is a recurring cost — before upgrading for performance, first check whether the query/index/streaming fix is the real answer (it was for the 2026-06 OOM: streaming + 512Mi beat a bigger box).

## Adding Destinations
When looking up coordinates for a new destination (shelter, summit, trailhead, etc.):
- **Primary source: OpenStreetMap** — use the OSM API (`https://nominatim.openstreetmap.org/search?q=<name>&format=json`) or OSM-derived sources (Gaia GPS, Mapbox). OSM is crowd-sourced and GPS-surveyed, giving accurate placement of physical structures.
- **Avoid GNIS-based sources** (TopoZone, some AllTrails entries) — GNIS coordinates are digitized from old paper topo maps and can be 100–200m off for backcountry features like shelters and huts.
- If the user has GPS tracks near the location, cross-check: query the centroid of tracking points within 300m and snap to it if sessions fall within a close radius.

## GPX Files
When downloading GPX files for the project (e.g. from Hiking Project, Wikiloc, AllTrails), **always verify the files are legitimate GPX** before considering the task complete. Many sources return HTML login pages instead of actual GPX data. Check that files start with `<?xml` and contain `<trkpt>` or `<rtept>` elements. Delete any invalid files immediately.

## React useEffect Rules
When writing or modifying `useEffect` hooks in the web app:
- **NEVER use objects or arrays as dependencies** — they create new references every render, causing infinite re-render loops. Use primitive values (strings, numbers, booleans) instead. For example, use `[userLat, userLng]` not `[userLocation]`.
- **NEVER set state inside an effect that re-triggers that same effect** — e.g. setting `locationStatus` inside an effect that depends on `[locationStatus]`.
- After modifying any page with useEffect, **verify the page doesn't infinite-loop** by loading it in the browser and confirming network requests stop after initial load.

## Owner
- **Josiah's Firebase UID**: `QzmvJRt5E5eTV4fAsuyLDrc4PEq1`
  - Use this when querying sessions, destinations, or any user-scoped data to identify Josiah's records
  - Sessions/data prefixed with `deleted_QzmvJRt5E5eTV4fAsuyLDrc4PEq1` are from a prior account migration — the live records use the bare UID

## Postgres → wire type policy (cloud-sql API)
`node-postgres` has surprising defaults for `BIGINT` and `NUMERIC` — both come over the wire as JS strings by default to preserve precision. That silently zeroed every tracking point's `time` on iOS once already (`d["time"] as? Int` fails on a numeric string). The API now registers a global `types.setTypeParser(20, parseInt)` in `cloud-sql/api/src/db.ts`. Do not remove it, do not move it below the `new Pool(...)` call, and do not convert more columns to `BIGINT` / `NUMERIC` without verifying that every client handles the wire format or that you've added a column-specific parser / `::text` cast. See `cloud-sql/CLAUDE.md` "Postgres → wire type policy" for the full contract + the regression test at `cloud-sql/api/src/__tests__/bigint-parser.test.ts`.

## Key Details
- Uses `firebase-functions` v4 (v1 API) and `firebase-admin` v11
- Node 20 runtime
- Secrets stored via `functions.config()` (not hardcoded) — never commit secrets
- `functions/functions/` is a legacy nested directory — do not use it
