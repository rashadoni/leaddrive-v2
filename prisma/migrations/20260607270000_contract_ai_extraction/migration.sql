-- CLM Slice 6a: AI clause + obligation extraction store
-- Additive: new table only, no existing table changes.

CREATE TABLE "contract_ai_extractions" (
    "id"                   TEXT NOT NULL,
    "organizationId"       TEXT NOT NULL,
    "contractId"           TEXT NOT NULL,
    "contractVersionId"    TEXT,
    "extractedClauses"     JSONB NOT NULL DEFAULT '[]',
    "extractedObligations" JSONB NOT NULL DEFAULT '[]',
    "model"                TEXT NOT NULL,
    "promptTokens"         INTEGER,
    "completionTokens"     INTEGER,
    "costUsd"              DECIMAL(10,6),
    "status"               TEXT NOT NULL DEFAULT 'completed',
    "createdBy"            TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_ai_extractions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_ai_extractions_organizationId_contractId_idx"
    ON "contract_ai_extractions"("organizationId", "contractId");

ALTER TABLE "contract_ai_extractions"
    ADD CONSTRAINT "contract_ai_extractions_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
