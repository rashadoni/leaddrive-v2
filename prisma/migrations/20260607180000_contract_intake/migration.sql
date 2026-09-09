-- CLM Slice 3d: Contract Intake / Request Forms
-- Additive migration — no existing data touched.

-- ContractIntakeForm: admin-configured form per contract type.
CREATE TABLE "contract_intake_forms" (
    "id"             TEXT         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "description"    TEXT,
    "contractType"   TEXT,
    "questions"      JSONB        NOT NULL DEFAULT '[]',
    "mapping"        JSONB        NOT NULL DEFAULT '{}',
    "defaultStages"  JSONB        NOT NULL DEFAULT '[]',
    "isActive"       BOOLEAN      NOT NULL DEFAULT true,
    "createdBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_intake_forms_pkey" PRIMARY KEY ("id")
);

-- ContractIntakeSubmission: a user's request submitted via an intake form.
CREATE TABLE "contract_intake_submissions" (
    "id"             TEXT         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "formId"         TEXT         NOT NULL,
    "responses"      JSONB        NOT NULL,
    "contractId"     TEXT,
    "status"         TEXT         NOT NULL DEFAULT 'submitted',
    "submittedBy"    TEXT,
    "submittedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_intake_submissions_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "contract_intake_forms"
    ADD CONSTRAINT "contract_intake_forms_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_intake_submissions"
    ADD CONSTRAINT "contract_intake_submissions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_intake_submissions"
    ADD CONSTRAINT "contract_intake_submissions_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "contract_intake_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_intake_submissions"
    ADD CONSTRAINT "contract_intake_submissions_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique constraint: one submission per spawned contract
CREATE UNIQUE INDEX "contract_intake_submissions_contractId_key"
    ON "contract_intake_submissions"("contractId");

-- Indexes
CREATE INDEX "contract_intake_forms_organizationId_isActive_idx"
    ON "contract_intake_forms"("organizationId", "isActive");

CREATE INDEX "contract_intake_submissions_organizationId_status_idx"
    ON "contract_intake_submissions"("organizationId", "status");
