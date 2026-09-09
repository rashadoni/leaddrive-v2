-- CLM Slice 6c: ContractEmbedding — pgvector semantic contract search
-- Mirrors kb_embeddings shape exactly (same extension, vector(512), hnsw index).
-- Additive: creates only new table + indexes. No existing schema touched.

-- Ensure pgvector extension exists (idempotent — already added by kb_embeddings migration).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "contract_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractVersionId" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(512) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'voyage-3-lite',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one embedding per contract (unique FK)
CREATE UNIQUE INDEX "contract_embeddings_contractId_key" ON "contract_embeddings"("contractId");

-- CreateIndex: org-scoped lookup
CREATE INDEX "contract_embeddings_organizationId_idx" ON "contract_embeddings"("organizationId");

-- CreateIndex: HNSW for fast cosine similarity search (mirrors kb_embeddings_embedding_idx)
CREATE INDEX "contract_embeddings_embedding_idx" ON "contract_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "contract_embeddings" ADD CONSTRAINT "contract_embeddings_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
