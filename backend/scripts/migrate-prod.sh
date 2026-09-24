#!/usr/bin/env bash
#
# Apply pending Prisma migrations to the production database.
#
# Nothing in the pipeline runs migrations — the container starts with
# `node src/server.js` — so a schema change is applied deliberately, by running
# this. The connection string is read from Secret Manager at run time: it is
# never written to disk, never committed, and never printed.
#
# Check what would run first:  npx prisma migrate status
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=karam-bot)" \
  npx prisma migrate deploy
