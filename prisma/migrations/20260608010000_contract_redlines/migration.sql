-- CLM Slice 6d — AI semantic redline between two ContractVersions.
-- Additive migration: new table only, no existing table altered.

CREATE TABLE "contract_redlines" (
    "id"                TEXT NOT NULL,
    "organizationId"    TEXT NOT NULL,
    "contractId"        TEXT NOT NULL,
    "fromVersionId"     TEXT NOT NULL,
    "toVersionId"       TEXT NOT NULL,
    "deltas"            JSONB NOT NULL DEFAULT '[]',
    "overallAssessment" TEXT NOT NULL DEFAULT '',
    "model"             TEXT NOT NULL,
    "promptTokens"      INTEGER,
    "completionTokens"  INTEGER,
    "costUsd"           DECIMAL(10,6),
    "status"            TEXT NOT NULL DEFAULT 'completed',
    "createdBy"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_redlines_pkey" PRIMARY KEY ("id")
);

-- FK: contractId → contracts
ALTER TABLE "contract_redlines"
    ADD CONSTRAINT "contract_redlines_contractId_fkey"
    FOREIGN KEY ("contractId")
    REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: fromVersionId → contract_versions
ALTER TABLE "contract_redlines"
    ADD CONSTRAINT "contract_redlines_fromVersionId_fkey"
    FOREIGN KEY ("fromVersionId")
    REFERENCES "contract_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: toVersionId → contract_versions
ALTER TABLE "contract_redlines"
    ADD CONSTRAINT "contract_redlines_toVersionId_fkey"
    FOREIGN KEY ("toVersionId")
    REFERENCES "contract_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite index for org-scoped contract lookup
CREATE INDEX "contract_redlines_organizationId_contractId_idx"
    ON "contract_redlines"("organizationId", "contractId");
