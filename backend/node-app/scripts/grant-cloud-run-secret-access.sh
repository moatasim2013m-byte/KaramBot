#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
SERVICE_ACCOUNT_EMAIL="${2:-peekaboo-indoor-playground@${PROJECT_ID}.iam.gserviceaccount.com}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL]"
  echo "Example: $0 gen-lang-client-0086895721"
  exit 1
fi

SECRETS=(
  MONGO_URL
  JWT_SECRET
  CAPITAL_BANK_SECRET_KEY
  CYBERSOURCE_MERCHANT_ID
  CAPITAL_BANK_ACCESS_KEY
  CAPITAL_BANK_PAYMENT_ENDPOINT
  CAPITAL_BANK_PROFILE_ID
  CYBERSOURCE_ENV
  PAYMENT_PROVIDER
  GEMINI_API_KEY
)

echo "Granting roles/secretmanager.secretAccessor to: ${SERVICE_ACCOUNT_EMAIL}"
echo "Project: ${PROJECT_ID}"

for secret in "${SECRETS[@]}"; do
  echo "- ${secret}"
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null

done

echo "Done. You can retry deployment now."
