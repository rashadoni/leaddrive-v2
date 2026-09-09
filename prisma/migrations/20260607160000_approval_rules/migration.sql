-- CLM Slice 3b: conditional approval routing
-- Additive migration — no existing tables modified.

-- ContractApprovalRule
CREATE TABLE "contract_approval_rules" (
    "id"             TEXT        NOT NULL,
    "organizationId" TEXT        NOT NULL,
    "templateId"     TEXT,
    "name"           TEXT        NOT NULL,
    "conditions"     JSONB       NOT NULL DEFAULT '[]',
    "matchLogic"     TEXT        NOT NULL DEFAULT 'all',
    "isActive"       BOOLEAN     NOT NULL DEFAULT true,
    "createdBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_approval_rules_pkey" PRIMARY KEY ("id")
);

-- ContractApprovalRuleAction
CREATE TABLE "contract_approval_rule_actions" (
    "id"             TEXT        NOT NULL,
    "ruleId"         TEXT        NOT NULL,
    "actionType"     TEXT        NOT NULL,
    "stageLabel"     TEXT,
    "assigneeUserId" TEXT,
    "assigneeRole"   TEXT,
    "atPosition"     INTEGER,
    "sortOrder"      INTEGER     NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_approval_rule_actions_pkey" PRIMARY KEY ("id")
);

-- FK: ContractApprovalRule → Organization
ALTER TABLE "contract_approval_rules"
    ADD CONSTRAINT "contract_approval_rules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: ContractApprovalRule → ContractTemplate (nullable, SetNull on delete)
ALTER TABLE "contract_approval_rules"
    ADD CONSTRAINT "contract_approval_rules_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: ContractApprovalRuleAction → ContractApprovalRule
ALTER TABLE "contract_approval_rule_actions"
    ADD CONSTRAINT "contract_approval_rule_actions_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "contract_approval_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "contract_approval_rules_organizationId_isActive_idx"
    ON "contract_approval_rules"("organizationId", "isActive");

CREATE INDEX "contract_approval_rule_actions_ruleId_sortOrder_idx"
    ON "contract_approval_rule_actions"("ruleId", "sortOrder");
