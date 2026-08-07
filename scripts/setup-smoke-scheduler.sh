#!/usr/bin/env bash
# One-time setup: Cloud Scheduler trigger for the peaks-smoke-job Cloud Run
# Job. Run once after the job's first deploy (CI creates/updates the job on
# every push to main; the scheduler only needs to exist once).
#
# Fires at 02:15, 08:15, 14:15, 20:15 UTC — ~2¼ h after each 48-hour HRRR
# cycle (00/06/12/18 UTC), when the f48 file is reliably on S3.
set -euo pipefail

PROJECT_ID="donner-a8608"
REGION="us-central1"
JOB="peaks-smoke-job"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Scheduler authenticates as the default compute SA; it needs run.jobs.run.
gcloud run jobs add-iam-policy-binding "$JOB" \
  --project="$PROJECT_ID" --region="$REGION" \
  --member="serviceAccount:${SA}" --role="roles/run.invoker"

gcloud scheduler jobs create http "${JOB}-trigger" \
  --project="$PROJECT_ID" --location="$REGION" \
  --schedule="15 2,8,14,20 * * *" --time-zone="Etc/UTC" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$SA"

echo "Scheduler ${JOB}-trigger created."
