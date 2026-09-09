-- CLM Slice 4b-1: contract_tags + implicit m2m join table
-- Additive only — no existing tables are altered.

CREATE TABLE "contract_tags" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "color"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_tags_pkey" PRIMARY KEY ("id")
);

-- Implicit Prisma m2m join table. Column names A/B are Prisma convention
-- (lexicographic order of model names: Contract < ContractTag → A=contractId, B=tagId).
CREATE TABLE "_ContractToContractTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- Unique pair + individual index on B (Prisma implicit m2m standard shape).
CREATE UNIQUE INDEX "_ContractToContractTag_AB_unique" ON "_ContractToContractTag"("A", "B");
CREATE INDEX "_ContractToContractTag_B_index" ON "_ContractToContractTag"("B");

-- Unique name per org.
CREATE UNIQUE INDEX "contract_tags_organizationId_name_key" ON "contract_tags"("organizationId", "name");

-- Index for org-scoped list queries.
CREATE INDEX "contract_tags_organizationId_idx" ON "contract_tags"("organizationId");

-- Foreign keys.
ALTER TABLE "contract_tags" ADD CONSTRAINT "contract_tags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContractToContractTag" ADD CONSTRAINT "_ContractToContractTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContractToContractTag" ADD CONSTRAINT "_ContractToContractTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "contract_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
