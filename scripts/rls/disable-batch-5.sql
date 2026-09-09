-- Instant rollback: RLS off for this batch. No data movement.

DROP POLICY IF EXISTS tenant_isolation ON "api_keys";
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "otp_codes";
ALTER TABLE "otp_codes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "otp_codes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "users";
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
