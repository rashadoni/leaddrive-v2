-- Server-first object-storage foundation for Field media. Existing v1 photo
-- URLs and document filesystem keys are untouched; only an explicitly
-- configured, exact `media` cohort will create rows here. A durable PENDING
-- row exists before an external PUT so a process crash has a bounded recovery
-- trail instead of silently orphaning encrypted bytes.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS "mtm_media_objects" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "uploaderAgentId" TEXT NOT NULL,
  "clientMediaId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL,
  "bucketName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "encryptionKeyId" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3) NOT NULL,
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "photoId" TEXT,
  "documentId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "committedAt" TIMESTAMP(3),
  "quarantinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_media_objects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_media_objects_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Composite references prevent a tenant-scoped media row from being linked
  -- to a photo, document or agent from another tenant. Restrict instead of
  -- cascade/set-null: lifecycle/retention code must make deletion explicit.
  CONSTRAINT "mtm_media_objects_uploaderAgent_fkey"
    FOREIGN KEY ("organizationId", "uploaderAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_media_objects_photo_fkey"
    FOREIGN KEY ("organizationId", "photoId") REFERENCES "mtm_photos"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_media_objects_document_fkey"
    FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_media_objects_provider_check"
    CHECK ("provider" = 'S3_COMPATIBLE'),
  CONSTRAINT "mtm_media_objects_kind_check"
    CHECK ("kind" IN ('PHOTO', 'DOCUMENT')),
  CONSTRAINT "mtm_media_objects_state_check"
    CHECK ("state" IN ('PENDING', 'COMMITTED', 'DELETE_PENDING', 'QUARANTINED', 'DELETED')),
  CONSTRAINT "mtm_media_objects_size_check"
    CHECK ("sizeBytes" > 0),
  CONSTRAINT "mtm_media_objects_digest_check"
    CHECK ("checksumSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mtm_media_objects_request_hash_check"
    CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mtm_media_objects_client_media_id_check"
    CHECK (char_length("clientMediaId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_media_objects_relation_kind_check"
    CHECK (
      ("photoId" IS NULL OR ("kind" = 'PHOTO' AND "documentId" IS NULL))
      AND ("documentId" IS NULL OR ("kind" = 'DOCUMENT' AND "photoId" IS NULL))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_bucketName_objectKey_key"
  ON "mtm_media_objects"("bucketName", "objectKey");
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_photoId_key"
  ON "mtm_media_objects"("photoId");
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_documentId_key"
  ON "mtm_media_objects"("documentId");
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_uploaderAgentId_clientMediaId_key"
  ON "mtm_media_objects"("organizationId", "uploaderAgentId", "clientMediaId");
CREATE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_state_createdAt_idx"
  ON "mtm_media_objects"("organizationId", "state", "createdAt");
CREATE INDEX IF NOT EXISTS "mtm_media_objects_state_retentionUntil_idx"
  ON "mtm_media_objects"("state", "retentionUntil");

ALTER TABLE "mtm_media_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_media_objects" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_media_objects";
CREATE POLICY tenant_isolation ON "mtm_media_objects"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
