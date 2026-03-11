# Peaks Firebase

## Project Structure
- `functions/` — Firebase Cloud Functions (TypeScript, compiled to `functions/lib/`)
- `functions/src/` — Source files
- `firestore.rules` — Firestore security rules
- `firebase.json` — Firebase project configuration

## Build & Lint
After making changes to functions, always verify:
```bash
cd functions && npm run build && npm run lint
```
- **Build**: `npm run build` (runs `tsc`)
- **Lint**: `npm run lint` (runs `eslint --ext .js,.ts .`)
- Lint must pass with zero errors. Warnings for unused `context` params in Firebase function signatures are acceptable.

## Deployment
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`) — deploys on push to `main`
- Deploy uses `--force` to auto-delete stale functions removed from source
- Service account credentials: stored as `FIREBASE_SERVICE_ACCOUNT` GitHub secret
- `firebase.ts` uses application default credentials in CI (falls back when `admin-service-account.json` is absent)

## Key Details
- Uses `firebase-functions` v4 (v1 API) and `firebase-admin` v11
- Node 20 runtime
- Secrets stored via `functions.config()` (not hardcoded) — never commit secrets
- `functions/functions/` is a legacy nested directory — do not use it
