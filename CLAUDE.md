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

## Key Details
- Uses `firebase-functions` v4 (v1 API) and `firebase-admin` v11
- Node 20 runtime
- Secrets stored via `functions.config()` (not hardcoded) — never commit secrets
- `functions/functions/` is a legacy nested directory — do not use it
