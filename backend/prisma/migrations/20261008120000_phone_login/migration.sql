-- Ten customers, P2 (docs/panels/spec.md «Schema changes», Migration 2): a shop owner signs in with
-- their mobile number, and email becomes optional (decisions-2026-10-08.md #3).
--
-- Backward compatible with the code in production: it adds one nullable column and drops one NOT
-- NULL. Every existing user keeps the email they sign in with, so no backfill is needed, and the
-- running code never writes NULL into email, so it behaves the same before and after this runs.
--
-- Rolling the CODE back after this: safe only while no users row has email NULL. The new code
-- creates phone-only owners; the old Prisma client models email as a required String and fails
-- (P2032) on any query that returns such a row, which breaks the admin user list and /me for that
-- shop. Before a rollback, give those rows a placeholder (UPDATE users SET email = phone ||
-- '@phone.invalid' WHERE email IS NULL) or deactivate them.
--
-- The SQL below is `prisma migrate diff` from the previous schema to this one.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
