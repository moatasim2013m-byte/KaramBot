#!/usr/bin/env bash
#
# Run once right after the panels (P0) code is deployed: re-applies the last_outbound_at backfill
# of migration 20261008090000_panels_foundation, for the replies the old code saved between that
# migration and the deploy. See backfill-last-outbound.sql. Safe to repeat.
#
# Like migrate-prod.sh, the connection string is read from Secret Manager at run time: never
# written to disk, never committed, never printed.
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=karam-bot)" \
  npx prisma db execute --schema prisma/schema.prisma --file scripts/backfill-last-outbound.sql
