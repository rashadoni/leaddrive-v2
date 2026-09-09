-- CLM Slice 6b: ContractRiskScore
-- AI risk-scoring result table. Stores per-contract playbook scoring results
-- (Anthropic haiku tool_use). Additive — no existing table touched.

CREATE TABLE "contract_risk_scores" (
    "id"               TEXT         NOT NULL,
    "organizationId"   TEXT         NOT NULL,
    "contractId"       TEXT         NOT NULL,
    "extractionId"     TEXT,
    "overallRisk"      TEXT         NOT NULL,
    "clauseScores"     JSONB        NOT NULL DEFAULT '[]',
    "model"            TEXT         NOT NULL,
    "promptTokens"     INTEGER,
    "completionTokens" INTEGER,
    "costUsd"          DECIMAL(10, 6),
    "status"           TEXT         NOT NULL DEFAULT 'completed',
    "createdBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_risk_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_risk_scores_organizationId_contractId_idx"
    ON "contract_risk_scores" ("organizationId", "contractId");

ALTER TABLE "contract_risk_scores"
    ADD CONSTRAINT "contract_risk_scores_contractId_fkey"
    FOREIGN KEY ("contractId")
    REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
