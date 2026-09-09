-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "kb_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(512) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kb_embeddings_articleId_key" ON "kb_embeddings"("articleId");

-- CreateIndex
CREATE INDEX "kb_embeddings_organizationId_idx" ON "kb_embeddings"("organizationId");

-- CreateIndex (HNSW for fast similarity search)
CREATE INDEX "kb_embeddings_embedding_idx" ON "kb_embeddings" USING hnsw ("embedding" vector_cosine_ops);
