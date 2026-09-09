-- Fresh-install compatibility: products pre-dated the inventory migration but
-- was never represented by a CREATE TABLE migration.
CREATE TABLE IF NOT EXISTS "products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'service',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "products_organizationId_idx" ON "products"("organizationId");
