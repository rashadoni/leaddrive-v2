-- PII encryption, stage 2b (owner 2026-10-22, «вариант 3»: no KMS, no Vault,
-- the master key stays on the server): every organization gets its own RANDOM
-- data key, stored here wrapped by the master key, with versions.
--
-- * Until now the tenant key was HKDF(master key, orgId): it could not be
--   destroyed for one organization, and a new master key meant re-encrypting
--   every value at once. A stored random key can be deleted (crypto-shredding)
--   and a new master key only rewraps these rows.
-- * The application creates version 1 on an organization's first request
--   (`src/lib/crypto/tenant-data-keys.ts`); this migration writes no rows, so
--   it holds no key material and needs no backfill.
-- * `tenant_master_keys` (2026-05) stays unused: its trigger forbids DELETE.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).

SET lock_timeout = '3s';

CREATE TABLE "tenant_data_keys" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "masterKeyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "tenant_data_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_data_keys_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_data_keys_version_positive" CHECK ("version" >= 1),
  -- IV(12) + key(32) + tag(16) = 60 bytes = 80 base64 characters.
  CONSTRAINT "tenant_data_keys_wrapped_key_shape" CHECK (length("wrappedKey") = 80)
);

-- Two processes creating an organization's first key race on this index;
-- the loser's INSERT … ON CONFLICT DO NOTHING keeps the winner's key.
CREATE UNIQUE INDEX "tenant_data_keys_organizationId_version_key"
  ON "tenant_data_keys"("organizationId", "version");

ALTER TABLE "tenant_data_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_data_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_data_keys"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
