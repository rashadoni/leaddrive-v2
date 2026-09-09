-- N17 Named Credentials (Phase 5 slice 1).
-- Per-tenant credential vault — AES-256-GCM ciphertext at rest.

CREATE TABLE "named_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "authConfig" JSONB NOT NULL DEFAULT '{}',
    "secretCiphertext" TEXT,
    "secretIv" TEXT,
    "secretTag" TEXT,
    "secretAlg" TEXT,
    "testStatus" TEXT NOT NULL DEFAULT 'untested',
    "testStatusMessage" TEXT,
    "testedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "named_credentials_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "named_credentials"
  ADD CONSTRAINT "named_credentials_authType_check"
  CHECK ("authType" IN ('bearer', 'basic', 'api_key_header', 'none'));

ALTER TABLE "named_credentials"
  ADD CONSTRAINT "named_credentials_testStatus_check"
  CHECK ("testStatus" IN ('ok', 'failed', 'untested'));

-- Ciphertext + iv + tag + alg must all be present or all NULL.
ALTER TABLE "named_credentials"
  ADD CONSTRAINT "named_credentials_secret_parts_consistent_check"
  CHECK (
    ("secretCiphertext" IS NULL AND "secretIv" IS NULL AND "secretTag" IS NULL AND "secretAlg" IS NULL)
    OR
    ("secretCiphertext" IS NOT NULL AND "secretIv" IS NOT NULL AND "secretTag" IS NOT NULL AND "secretAlg" IS NOT NULL)
  );

-- authType=none MUST have no ciphertext; non-none MUST have it.
ALTER TABLE "named_credentials"
  ADD CONSTRAINT "named_credentials_secret_required_by_authType_check"
  CHECK (
    ("authType" = 'none' AND "secretCiphertext" IS NULL)
    OR
    ("authType" <> 'none' AND "secretCiphertext" IS NOT NULL)
  );

CREATE UNIQUE INDEX "named_credentials_org_name_uniq"
  ON "named_credentials"("organizationId", "name");

CREATE INDEX "named_credentials_org_idx"
  ON "named_credentials"("organizationId");

ALTER TABLE "named_credentials"
  ADD CONSTRAINT "named_credentials_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
