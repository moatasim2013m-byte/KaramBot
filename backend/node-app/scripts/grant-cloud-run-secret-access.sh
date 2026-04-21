#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
SERVICE_ACCOUNT_EMAIL="${2:-peekaboo-indoor-playground@${PROJECT_ID}.iam.gserviceaccount.com}"
SERVICE_NAME="${3:-peekaboo-indoor-playground}"
REGION="${4:-us-west1}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL] [SERVICE_NAME] [REGION]"
  echo "Example: $0 gen-lang-client-0086895721"
  exit 1
fi

STATIC_SECRETS=(
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
echo "Service: ${SERVICE_NAME} (${REGION})"

RUNTIME_SECRETS="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(spec.template.spec.containers[0].env[].valueSource.secretKeyRef.secret)' 2>/dev/null || true)"

if [[ -n "${RUNTIME_SECRETS}" ]]; then
  echo "Detected secret refs from current Cloud Run service configuration."
else
  echo "No runtime secret refs detected from Cloud Run service description (or service not found)."
fi

mapfile -t ALL_SECRETS < <(
  printf '%s\n' "${STATIC_SECRETS[@]}"
  printf '%s\n' "${RUNTIME_SECRETS}" | sed '/^[[:space:]]*$/d'
)

mapfile -t UNIQUE_SECRETS < <(printf '%s\n' "${ALL_SECRETS[@]}" | sort -u)

echo "Applying IAM policy binding for $((${#UNIQUE_SECRETS[@]})) secrets..."
for secret in "${UNIQUE_SECRETS[@]}"; do
  echo "- ${secret}"
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
done

echo "Done. You can retry deployment now."
