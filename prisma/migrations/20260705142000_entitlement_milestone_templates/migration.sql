-- Tenant-scoped editable milestone templates for support entitlements.

CREATE TABLE "entitlement_milestone_templates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "supportLevel" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "entitlement_milestone_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_milestone_templates_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "entitlement_milestone_templates_supportLevel_check"
    CHECK ("supportLevel" IN ('basic', 'standard', 'premium', 'enterprise')),
  CONSTRAINT "entitlement_milestone_templates_name_check"
    CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "entitlement_milestone_templates_org_level_key"
  ON "entitlement_milestone_templates" ("organizationId", "supportLevel");

CREATE INDEX "entitlement_milestone_templates_org_active_idx"
  ON "entitlement_milestone_templates" ("organizationId", "isActive");

CREATE TABLE "entitlement_milestone_template_rules" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "severityTier" TEXT,
  "dueWithinSeconds" INTEGER NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "entitlement_milestone_template_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_milestone_template_rules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "entitlement_milestone_template_rules_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "entitlement_milestone_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "entitlement_milestone_template_rules_type_check"
    CHECK ("type" IN ('first_response', 'problem_identified', 'workaround_delivered', 'resolution', 'escalation')),
  CONSTRAINT "entitlement_milestone_template_rules_severityTier_check"
    CHECK ("severityTier" IS NULL OR "severityTier" IN ('critical', 'high', 'normal', 'low')),
  CONSTRAINT "entitlement_milestone_template_rules_name_check"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "entitlement_milestone_template_rules_due_check"
    CHECK ("dueWithinSeconds" > 0 AND "dueWithinSeconds" <= 31536000)
);

CREATE INDEX "entitlement_milestone_template_rules_org_template_idx"
  ON "entitlement_milestone_template_rules" ("organizationId", "templateId");

CREATE UNIQUE INDEX "entitlement_milestone_template_rules_template_type_severity_key"
  ON "entitlement_milestone_template_rules" (
    "templateId",
    "type",
    COALESCE("severityTier", '')
  );

ALTER TABLE "entitlement_milestone_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_milestone_template_rules" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "entitlement_milestone_templates"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

CREATE POLICY tenant_isolation ON "entitlement_milestone_template_rules"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
