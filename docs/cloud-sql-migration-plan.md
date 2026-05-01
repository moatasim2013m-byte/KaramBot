# Cloud SQL Migration Plan (MongoDB → PostgreSQL)

> **Status: Completed**
> The backend has been migrated from MongoDB/Mongoose to PostgreSQL via Prisma ORM.
> This document describes the migration approach that was followed and serves as a reference
> for the schema design decisions made. The Cloud SQL instance still needs to be provisioned
> in GCP and `DATABASE_URL` set to a real PostgreSQL connection string before the app can run
> in production with a live database.

---

## Why PostgreSQL on Cloud SQL

| Need | Benefit |
|------|---------|
| Relational joins (orders ↔ items ↔ users) | Native foreign keys, no manual population |
| ACID transactions | Safe multi-row writes (e.g. place order + update inventory atomically) |
| Platform-native managed service | Cloud SQL integrates with Cloud Run via Unix socket, IAM auth, automated backups |
| Analytics / reporting | Standard SQL aggregations; easy to connect Looker / BigQuery |
| Subscription billing (Phase 5) | Row-level security per `business_id` is trivial in PostgreSQL |

---

## Current MongoDB Models → PostgreSQL Tables

The mapping below covers every Mongoose schema in `backend/src/models/`.
`ObjectId` references become `UUID` or `BIGSERIAL` foreign keys.
Embedded sub-documents become either JSONB columns (denormalized) or separate tables (normalized), noted per field.

### `businesses`

| Mongoose field | PG column | Type | Notes |
|---|---|---|---|
| `_id` | `id` | `UUID DEFAULT gen_random_uuid()` | PK |
| `name` | `name` | `TEXT NOT NULL` | |
| `slug` | `slug` | `TEXT NOT NULL UNIQUE` | |
| `business_type` | `business_type` | `TEXT` | CHECK constraint on enum values |
| `logo_url` | `logo_url` | `TEXT` | |
| `language_default` | `language_default` | `TEXT DEFAULT 'ar'` | |
| `timezone` | `timezone` | `TEXT DEFAULT 'Asia/Amman'` | |
| `currency` | `currency` | `TEXT DEFAULT 'JOD'` | |
| `address` | `address` | `TEXT` | |
| `wa_phone_number_id` | `wa_phone_number_id` | `TEXT NOT NULL UNIQUE` | |
| `wa_business_account_id` | `wa_business_account_id` | `TEXT` | |
| `wa_access_token` | `wa_access_token` | `TEXT` | Store in Secret Manager, not in DB |
| `opening_hours` (array) | `opening_hours` | `JSONB` | Keep as JSONB; 7-element array is stable |
| `status` | `status` | `TEXT DEFAULT 'active'` | CHECK ('active','inactive') |
| `ai_config` (nested) | `ai_config` | `JSONB NOT NULL DEFAULT '{}'` | Denormalized; rarely queried by column |
| `policies` (nested) | `policies` | `JSONB NOT NULL DEFAULT '{}'` | Same rationale |
| `created_at` | `created_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `updated_at` | `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Trigger: `updated_at = now()` |

### `users`

| Mongoose field | PG column | Type | Notes |
|---|---|---|---|
| `_id` | `id` | `UUID DEFAULT gen_random_uuid()` | PK |
| `name` | `name` | `TEXT NOT NULL` | |
| `email` | `email` | `TEXT NOT NULL UNIQUE` | |
| `password` | `password_hash` | `TEXT NOT NULL` | bcrypt; never expose |
| `role` | `role` | `TEXT NOT NULL DEFAULT 'staff'` | CHECK on enum |
| `business_id` | `business_id` | `UUID REFERENCES businesses(id)` | NULL for platform_admin |
| `active` | `active` | `BOOLEAN DEFAULT TRUE` | |
| `last_login` | `last_login` | `TIMESTAMPTZ` | |
| `created_at` / `updated_at` | same | `TIMESTAMPTZ` | |

### `conversations`

| Mongoose field | PG column | Type | Notes |
|---|---|---|---|
| `_id` | `id` | `UUID` | PK |
| `business_id` | `business_id` | `UUID NOT NULL REFERENCES businesses(id)` | Index |
| `customer_wa_id` | `customer_wa_id` | `TEXT NOT NULL` | |
| `profile_name` | `profile_name` | `TEXT` | |
| `status` | `status` | `TEXT DEFAULT 'open'` | CHECK on enum |
| `assigned_staff_id` | `assigned_staff_id` | `UUID REFERENCES users(id)` | |
| `last_message_at` | `last_message_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `last_inbound_at` | `last_inbound_at` | `TIMESTAMPTZ` | |
| `unread_count` | `unread_count` | `INT DEFAULT 0` | |
| `ai_enabled` | `ai_enabled` | `BOOLEAN DEFAULT TRUE` | |
| `current_workflow_type` | `current_workflow_type` | `TEXT` | CHECK or NULL |
| `current_state` | `current_state` | `TEXT` | |
| `workflow_data` | `workflow_data` | `JSONB DEFAULT '{}'` | Cart / draft order |
| `metadata` | `metadata` | `JSONB DEFAULT '{}'` | |
| `created_at` / `updated_at` | same | `TIMESTAMPTZ` | |

Unique index: `(business_id, customer_wa_id)`.

### `messages`

| Mongoose field | PG column | Type | Notes |
|---|---|---|---|
| `_id` | `id` | `UUID` | PK |
| `business_id` | `business_id` | `UUID NOT NULL REFERENCES businesses(id)` | |
| `conversation_id` | `conversation_id` | `UUID NOT NULL REFERENCES conversations(id)` | |
| `meta_message_id` | `meta_message_id` | `TEXT UNIQUE` | sparse → nullable unique |
| `direction` | `direction` | `TEXT NOT NULL` | CHECK ('inbound','outbound') |
| `message_type` | `message_type` | `TEXT DEFAULT 'text'` | CHECK on enum |
| `text_body` | `text_body` | `TEXT` | |
| `media_id` / `media_mime_type` / `media_url` | same | `TEXT` | |
| `interactive_reply` | `interactive_reply` | `JSONB` | |
| `location` (nested) | `location` | `JSONB` | `{latitude, longitude, name, address}` |
| `status` | `status` | `TEXT DEFAULT 'pending'` | CHECK on enum |
| `sender_wa_id` | `sender_wa_id` | `TEXT` | |
| `sent_by_user_id` | `sent_by_user_id` | `UUID REFERENCES users(id)` | |
| `is_ai_generated` | `is_ai_generated` | `BOOLEAN DEFAULT FALSE` | |
| `raw_payload` | `raw_payload` | `JSONB` | |
| `created_at` / `updated_at` | same | `TIMESTAMPTZ` | |

### `categories`

Straight column mapping. `business_id UUID NOT NULL REFERENCES businesses(id)`.

### `modifier_groups` + `modifier_options`

`modifier_options` becomes a child table with `modifier_group_id UUID REFERENCES modifier_groups(id)`.
Alternatively keep `options` as `JSONB` if the array is always fetched with its parent.

### `menu_items`

`modifier_groups` (array of ObjectId refs) → junction table `menu_item_modifier_groups(menu_item_id, modifier_group_id)`.

### `orders`

| Mongoose field | PG column | Type |
|---|---|---|
| `items` (embedded array) | `items` | `JSONB` — snapshot of ordered items; denormalized intentionally |
| `location` | `location` | `JSONB` |
| `status_history` | `status_history` | `JSONB` or separate `order_status_history` table |
| All scalar fields | direct columns | same types as above |

### Clinic models (`services`, `doctors`, `appointment_slots`, `appointments`)

Direct column mapping. `services[]` on `doctors` → junction table `doctor_services(doctor_id, service_id)`.

---

## Migration Approach (When Ready)

### Phase A – Dual-write (zero downtime)
1. Provision Cloud SQL PostgreSQL instance (private IP, same VPC as Cloud Run).
2. Prisma ORM was used as the new data layer (replacing Mongoose).
3. Write new records to both MongoDB and PostgreSQL simultaneously.
4. Run a backfill script to copy historical data (convert ObjectIds to UUIDs with a stable hash or a mapping table).

### Phase B – Read migration
5. Shift read queries to PostgreSQL one model at a time, starting with `Message` (high volume, easy to validate).
6. Compare results between MongoDB and PostgreSQL reads in a shadow mode.
7. Validate `Conversation`, `Order`, `User`, `Business`, menu models in order.

### Phase C – Cut over
8. Stop all MongoDB writes; MongoDB becomes read-only archive.
9. Update `MONGO_URL` env var to be unset; remove `mongoose.connect` call.
10. Keep MongoDB Atlas free tier as cold backup for 30 days, then terminate.

### Phase D – Cleanup
11. Remove Mongoose and all model files.
12. Update `architecture.md` stack table (MongoDB → PostgreSQL).

---

## Prerequisites Before Starting

- [ ] Cloud SQL PostgreSQL 15 instance created in GCP project
- [ ] Cloud SQL Auth Proxy or private IP connectivity from Cloud Run configured
- [ ] `DATABASE_URL` secret added to Secret Manager
- [ ] Schema DDL reviewed and applied via migration tool (e.g. `node-pg-migrate` or raw SQL scripts)
- [ ] Data backfill script written and tested against a staging clone of MongoDB Atlas

---

## What Does NOT Change During Migration

- All Express routes and service layer logic
- WhatsApp webhook handler
- JWT authentication middleware
- AI provider integrations (Gemini / OpenAI)
- Frontend (React dashboard)
- `SKIP_DB_CONNECT=true` preview mode (remains valid until Phase C)

---

## Related Documents

- [`architecture.md`](./architecture.md) — current stack
- [`deployment-cloud-run.md`](./deployment-cloud-run.md) — Cloud Run deployment
- [`future-roadmap.md`](./future-roadmap.md) — overall feature roadmap
