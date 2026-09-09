-- CLM Slice 1a — contract versioning + reusable clause library.
-- 100% ADDITIVE: two new tables; no existing columns altered.
-- `contract_versions.contractId` carries a CASCADE FK to `contracts`;
-- `contract_clauses` is org-scoped but has no FK beyond that convention
-- (fallbackOfClauseId is a plain string reference, not a PG FK).

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "renderedBody" TEXT,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'draft',
    "isCanonicalSigned" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_clauses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'standard',
    "governingLaw" TEXT,
    "fallbackOfClauseId" TEXT,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contractId_versionNo_key" ON "contract_versions"("contractId", "versionNo");

-- CreateIndex
CREATE INDEX "contract_versions_organizationId_contractId_idx" ON "contract_versions"("organizationId", "contractId");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_category_idx" ON "contract_clauses"("organizationId", "category");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_status_idx" ON "contract_clauses"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
