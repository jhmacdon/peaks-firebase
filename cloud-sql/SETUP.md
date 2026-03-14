# Peaks Cloud SQL + PostGIS Setup

Step-by-step guide to provision Cloud SQL for PostgreSQL with PostGIS on your existing Firebase/GCP project, deploy the Cloud Run API, and run the Firestore backfill.

## Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- Your Firebase project ID (run `firebase projects:list` if unsure)
- Docker installed (for Cloud Run deployment)

```bash
# Authenticate and set project
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## 1. Enable Required APIs

```bash
gcloud services enable sqladmin.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

## 2. Create the Cloud SQL Instance

Pick the same region as your Firebase project (check Firebase console → Project Settings → General).

```bash
# Dev instance (db-f1-micro is cheapest, ~$7/month)
# Change --region to match your Firebase region
gcloud sql instances create peaks-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=10GB \
  --availability-type=zonal

# Wait for it to finish (~5 minutes)
```

## 3. Set the Postgres Password and Create the API User

```bash
# Set root postgres password
gcloud sql users set-password postgres \
  --instance=peaks-db \
  --password=YOUR_POSTGRES_PASSWORD

# Create the API user
gcloud sql users create peaks-api \
  --instance=peaks-db \
  --password=YOUR_API_PASSWORD
```

## 4. Create the Database and Enable Extensions

```bash
# Create the peaks database
gcloud sql databases create peaks --instance=peaks-db

# Connect via Cloud SQL Auth Proxy to run the schema
# (in a separate terminal)
gcloud sql connect peaks-db --user=postgres --database=peaks
```

Once connected to the `psql` prompt:

```sql
-- Run the full schema
\i cloud-sql/schema.sql
```

Or if connecting remotely:

```bash
# Install Cloud SQL Auth Proxy
gcloud components install cloud-sql-proxy

# Start proxy (separate terminal, leave running)
cloud-sql-proxy YOUR_PROJECT_ID:us-central1:peaks-db

# Then in another terminal, run schema via psql
PGPASSWORD=YOUR_POSTGRES_PASSWORD psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/schema.sql
```

## 5. Store Secrets

```bash
# Store the DB password in Secret Manager (Cloud Run reads it at runtime)
echo -n "YOUR_API_PASSWORD" | gcloud secrets create peaks-db-password \
  --data-file=- \
  --replication-policy=automatic

# Grant Cloud Run's service account access
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding peaks-db-password \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6. Deploy the Cloud Run API

```bash
cd cloud-sql/api

# Build TypeScript
npm install
npm run build

# Get the instance connection name
INSTANCE_CONNECTION=$(gcloud sql instances describe peaks-db --format='value(connectionName)')

# Build and deploy to Cloud Run
gcloud run deploy peaks-api \
  --source=. \
  --region=us-central1 \
  --platform=managed \
  --no-allow-unauthenticated \
  --add-cloudsql-instances=$INSTANCE_CONNECTION \
  --set-env-vars="INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION,DB_NAME=peaks,DB_USER=peaks-api" \
  --set-secrets="DB_PASS=peaks-db-password:latest" \
  --min-instances=0 \
  --max-instances=5 \
  --memory=256Mi
```

### Allow Authenticated Requests (Firebase Auth users)

Cloud Run's `--no-allow-unauthenticated` blocks public access at the infra level, but our API handles auth itself via Firebase ID tokens. So we need to allow all traffic to reach the service, and let our `requireAuth` middleware handle it:

```bash
gcloud run services add-iam-policy-binding peaks-api \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

This is safe because every `/api/*` endpoint requires a valid Firebase Auth token.

### Verify

```bash
# Get the service URL
API_URL=$(gcloud run services describe peaks-api --region=us-central1 --format='value(status.url)')

# Health check (no auth needed)
curl $API_URL/health
# → {"status":"ok"}

# Authenticated request (replace TOKEN with a Firebase ID token)
curl -H "Authorization: Bearer TOKEN" $API_URL/api/search?q=rainier
```

## 7. Run the Migration

```bash
cd cloud-sql/migrate
npm install

# Start Cloud SQL Auth Proxy (if not already running)
cloud-sql-proxy YOUR_PROJECT_ID:us-central1:peaks-db &

# Set env vars for the migration
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=peaks
export DB_USER=postgres
export DB_PASS=YOUR_POSTGRES_PASSWORD

# Run full migration (destinations → lists → routes → sessions → points)
npm run migrate

# Or run individual tables
npm run migrate:destinations
npm run migrate:routes
npm run migrate:sessions
npm run migrate:points
```

### Verify Migration

```bash
PGPASSWORD=$DB_PASS psql -h 127.0.0.1 -U postgres -d peaks -c "
  SELECT 'destinations' AS table_name, COUNT(*) FROM destinations
  UNION ALL SELECT 'routes', COUNT(*) FROM routes
  UNION ALL SELECT 'lists', COUNT(*) FROM lists
  UNION ALL SELECT 'tracking_sessions', COUNT(*) FROM tracking_sessions
  UNION ALL SELECT 'tracking_points', COUNT(*) FROM tracking_points
  UNION ALL SELECT 'session_markers', COUNT(*) FROM session_markers;
"
```

## 8. iOS Client Configuration

Add the Cloud Run API URL to your app config. The iOS client sends requests with the Firebase Auth ID token:

```swift
// Get the current user's ID token
Auth.auth().currentUser?.getIDToken { token, error in
    guard let token = token else { return }

    var request = URLRequest(url: URL(string: "https://peaks-api-HASH-uc.a.run.app/api/search?q=rainier")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    URLSession.shared.dataTask(with: request) { data, response, error in
        // handle response
    }.resume()
}
```

## Cost Estimate (Dev)

| Resource | Monthly Cost |
|---|---|
| Cloud SQL db-f1-micro | ~$7 |
| Cloud SQL storage (10GB SSD) | ~$2 |
| Cloud Run (min 0, pay per request) | ~$0–5 |
| Secret Manager | ~$0 |
| **Total** | **~$10–15/month** |

Scale up the instance tier (`db-g1-small` → `db-custom-*`) when you need more capacity.

## Useful Commands

```bash
# Connect to database
gcloud sql connect peaks-db --user=postgres --database=peaks

# View Cloud Run logs
gcloud run services logs read peaks-api --region=us-central1

# Update Cloud Run service
gcloud run deploy peaks-api --source=. --region=us-central1

# View instance info
gcloud sql instances describe peaks-db
```
