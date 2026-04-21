# Cloud Run deploy fix: Secret Manager access denied

If Cloud Run deploy fails with errors like:

- `Permission denied on secret ... for Revision service account ...`
- `must be granted roles/secretmanager.secretAccessor`

grant the runtime service account access to the required secrets.

## One-time fix (per project/service account)

From repo root:

```bash
backend/node-app/scripts/grant-cloud-run-secret-access.sh gen-lang-client-0086895721
```

Or with explicit service account/service/region:

```bash
backend/node-app/scripts/grant-cloud-run-secret-access.sh \
  gen-lang-client-0086895721 \
  peekaboo-indoor-playground@gen-lang-client-0086895721.iam.gserviceaccount.com \
  peekaboo-indoor-playground \
  us-west1
```

The script grants access to:

- a maintained baseline list of required secrets, and
- any secret references currently configured on the Cloud Run service
  (`spec.template.spec.containers[0].env[].valueSource.secretKeyRef.secret`).

This helps when new secret env vars are added over time and avoids missing IAM bindings during deploy.

## Verify a single secret binding

```bash
gcloud secrets get-iam-policy MONGO_URL --project=gen-lang-client-0086895721
```

Look for:

- `role: roles/secretmanager.secretAccessor`
- `serviceAccount:peekaboo-indoor-playground@gen-lang-client-0086895721.iam.gserviceaccount.com`

## Retry deploy

```bash
gcloud run deploy peekaboo-indoor-playground --region=us-west1
```
