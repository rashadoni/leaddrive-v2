-- Tenant Provisioning v2: durable, retryable bootstrap and provider entitlements.
CREATE TABLE "tenant_provisioning_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 2,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_provisioning_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_provisioning_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_provisioning_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_provider_entitlements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "billingMode" TEXT NOT NULL DEFAULT 'disabled',
    "credentialMode" TEXT NOT NULL DEFAULT 'none',
    "status" TEXT NOT NULL DEFAULT 'needs_access',
    "spendPolicy" JSONB NOT NULL DEFAULT '{}',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_provider_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_provisioning_runs_org_id_key"
ON "tenant_provisioning_runs"("organizationId", "id");
CREATE UNIQUE INDEX "tenant_provisioning_runs_org_idempotency_key"
ON "tenant_provisioning_runs"("organizationId", "idempotencyKey");
CREATE INDEX "tenant_provisioning_runs_org_status_idx"
ON "tenant_provisioning_runs"("organizationId", "status", "createdAt");
CREATE INDEX "tenant_provisioning_runs_lease_until_idx"
ON "tenant_provisioning_runs"("leaseUntil");

CREATE UNIQUE INDEX "tenant_provisioning_steps_org_run_step_key"
ON "tenant_provisioning_steps"("organizationId", "runId", "stepKey");
CREATE INDEX "tenant_provisioning_steps_org_status_idx"
ON "tenant_provisioning_steps"("organizationId", "status", "updatedAt");

CREATE UNIQUE INDEX "tenant_provider_entitlements_org_provider_key"
ON "tenant_provider_entitlements"("organizationId", "providerKey");
CREATE INDEX "tenant_provider_entitlements_org_status_idx"
ON "tenant_provider_entitlements"("organizationId", "status");

ALTER TABLE "tenant_provisioning_runs"
ADD CONSTRAINT "tenant_provisioning_runs_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_provisioning_steps"
ADD CONSTRAINT "tenant_provisioning_steps_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_provisioning_steps"
ADD CONSTRAINT "tenant_provisioning_steps_organizationId_runId_fkey"
FOREIGN KEY ("organizationId", "runId") REFERENCES "tenant_provisioning_runs"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_provider_entitlements"
ADD CONSTRAINT "tenant_provider_entitlements_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_provisioning_runs"
ADD CONSTRAINT "tenant_provisioning_runs_status_check"
CHECK ("status" IN ('pending', 'running', 'completed', 'partial', 'failed'));
ALTER TABLE "tenant_provisioning_runs"
ADD CONSTRAINT "tenant_provisioning_runs_lease_pair_check"
CHECK (("leaseToken" IS NULL) = ("leaseUntil" IS NULL));

ALTER TABLE "tenant_provisioning_steps"
ADD CONSTRAINT "tenant_provisioning_steps_status_check"
CHECK ("status" IN ('pending', 'running', 'completed', 'blocked', 'failed'));

ALTER TABLE "tenant_provider_entitlements"
ADD CONSTRAINT "tenant_provider_entitlements_billing_mode_check"
CHECK ("billingMode" IN ('disabled', 'platform', 'byok'));
ALTER TABLE "tenant_provider_entitlements"
ADD CONSTRAINT "tenant_provider_entitlements_credential_mode_check"
CHECK ("credentialMode" IN ('none', 'platform_secret', 'tenant_secret'));
ALTER TABLE "tenant_provider_entitlements"
ADD CONSTRAINT "tenant_provider_entitlements_status_check"
CHECK ("status" IN ('ready', 'needs_access', 'disabled', 'suspended'));

-- These tables contain tenant-scoped configuration and operational state.
-- Provisioning runs execute inside the existing explicit RLS-bypass context;
-- every normal request remains isolated to app.org_id.
ALTER TABLE "tenant_provisioning_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_provisioning_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_provider_entitlements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_provisioning_runs_tenant_isolation"
ON "tenant_provisioning_runs"
USING (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
)
WITH CHECK (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
);

CREATE POLICY "tenant_provisioning_steps_tenant_isolation"
ON "tenant_provisioning_steps"
USING (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
)
WITH CHECK (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
);

CREATE POLICY "tenant_provider_entitlements_tenant_isolation"
ON "tenant_provider_entitlements"
USING (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
)
WITH CHECK (
  "organizationId" = current_setting('app.org_id', true)
  OR current_setting('app.rls_bypass', true) = 'on'
);
