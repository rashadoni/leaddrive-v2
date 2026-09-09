-- CLM Slice 7d — E-sign provider seam (DocuSign optional, native unchanged)
--
-- Additive migration:
--   1. EsignProviderConfig table (encrypted creds, admin-gated CRUD).
--   2. EsignEnvelope: add provider (default "native"), externalEnvelopeId, providerConfigId FK.
--
-- All changes are additive — default "native" on provider preserves every
-- existing EsignEnvelope row as native. No existing data is touched.

-- ─── 1. EsignProviderConfig table ────────────────────────────────────────────

CREATE TABLE "esign_provider_configs" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider"       TEXT NOT NULL,
    -- ENCRYPTED JSON blob (AES-256-GCM via encryptForTenant). NEVER plaintext.
    "config"         TEXT NOT NULL,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esign_provider_configs_pkey" PRIMARY KEY ("id")
);

-- Org FK
ALTER TABLE "esign_provider_configs"
    ADD CONSTRAINT "esign_provider_configs_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One config per (org, provider)
CREATE UNIQUE INDEX "esign_provider_configs_organizationId_provider_key"
    ON "esign_provider_configs"("organizationId", "provider");

CREATE INDEX "esign_provider_configs_organizationId_idx"
    ON "esign_provider_configs"("organizationId");

-- ─── 2. EsignEnvelope — additive columns ─────────────────────────────────────

-- provider: default "native" so all existing rows are unaffected
ALTER TABLE "esign_envelopes"
    ADD COLUMN IF NOT EXISTS "provider"            TEXT NOT NULL DEFAULT 'native',
    ADD COLUMN IF NOT EXISTS "externalEnvelopeId"  TEXT,
    ADD COLUMN IF NOT EXISTS "providerConfigId"    TEXT;

-- FK to EsignProviderConfig (nullable; native envelopes have NULL)
ALTER TABLE "esign_envelopes"
    ADD CONSTRAINT "esign_envelopes_providerConfigId_fkey"
    FOREIGN KEY ("providerConfigId")
    REFERENCES "esign_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "esign_envelopes_providerConfigId_idx"
    ON "esign_envelopes"("providerConfigId");
