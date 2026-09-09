-- Social legal-escalation dossier.
-- Operators flag mentions as legal cases (insult / defamation / false
-- accusation / threat) and bundle open cases into period reports with an
-- AI-drafted complaint letter. Letters stay drafts for lawyer review.

CREATE TABLE IF NOT EXISTS "social_legal_reports" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "recipient" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "letterLanguage" TEXT NOT NULL DEFAULT 'az',
  "letterText" TEXT,
  "letterSource" TEXT NOT NULL DEFAULT 'none',
  "finalizedBy" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_legal_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_legal_cases" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "reportId" TEXT,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "aiSuggested" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "flaggedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_legal_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_legal_cases_organizationId_mentionId_key"
  ON "social_legal_cases" ("organizationId", "mentionId");

CREATE INDEX IF NOT EXISTS "social_legal_cases_organizationId_status_createdAt_idx"
  ON "social_legal_cases" ("organizationId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "social_legal_cases_organizationId_reportId_idx"
  ON "social_legal_cases" ("organizationId", "reportId");

CREATE INDEX IF NOT EXISTS "social_legal_reports_organizationId_status_createdAt_idx"
  ON "social_legal_reports" ("organizationId", "status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_legal_reports_organizationId_fkey'
  ) THEN
    ALTER TABLE "social_legal_reports"
      ADD CONSTRAINT "social_legal_reports_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_legal_cases_organizationId_fkey'
  ) THEN
    ALTER TABLE "social_legal_cases"
      ADD CONSTRAINT "social_legal_cases_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_legal_cases_mentionId_fkey'
  ) THEN
    ALTER TABLE "social_legal_cases"
      ADD CONSTRAINT "social_legal_cases_mentionId_fkey"
      FOREIGN KEY ("mentionId") REFERENCES "social_mentions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_legal_cases_reportId_fkey'
  ) THEN
    ALTER TABLE "social_legal_cases"
      ADD CONSTRAINT "social_legal_cases_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "social_legal_reports"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "social_legal_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_cases" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_reports";
CREATE POLICY tenant_isolation ON "social_legal_reports"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_cases";
CREATE POLICY tenant_isolation ON "social_legal_cases"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
