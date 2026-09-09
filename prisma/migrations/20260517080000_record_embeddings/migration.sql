-- H13 Einstein Semantic Search (Phase 3 slice 1).
-- Cross-record embedding store. Float[] for slice 1; slice 2 migrates
-- to pgvector for native kNN ops.

CREATE TABLE "record_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "embeddedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "record_embeddings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "record_embeddings"
  ADD CONSTRAINT "record_embeddings_recordType_check"
  CHECK ("recordType" IN ('deal', 'contact', 'company', 'ticket', 'kb_article'));

CREATE UNIQUE INDEX "record_embeddings_org_type_id_uniq"
  ON "record_embeddings"("organizationId", "recordType", "recordId");

CREATE INDEX "record_embeddings_org_type_idx"
  ON "record_embeddings"("organizationId", "recordType");

-- Truncation path orders by embeddedAt desc — index prevents sort-on-disk.
CREATE INDEX "record_embeddings_org_embeddedAt_idx"
  ON "record_embeddings"("organizationId", "embeddedAt");

ALTER TABLE "record_embeddings"
  ADD CONSTRAINT "record_embeddings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
