-- CLM Slice 4c: Clause governance deviation detection
-- ContractDeviationFlag — additive, no breaking changes.

CREATE TABLE "contract_deviation_flags" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId"     TEXT NOT NULL,
    "clauseId"       TEXT,
    "clauseTitle"    TEXT NOT NULL,
    "deviationType"  TEXT NOT NULL,
    "severity"       TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'flagged',
    "waivedBy"       TEXT,
    "waivedAt"       TIMESTAMP(3),
    "waivedReason"   TEXT,
    "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedBy"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_deviation_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_deviation_flags_organizationId_contractId_idx" ON "contract_deviation_flags"("organizationId", "contractId");
CREATE INDEX "contract_deviation_flags_organizationId_status_idx"     ON "contract_deviation_flags"("organizationId", "status");

ALTER TABLE "contract_deviation_flags"
    ADD CONSTRAINT "contract_deviation_flags_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
