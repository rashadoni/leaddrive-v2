CREATE TABLE IF NOT EXISTS "survey_unsubscribes" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "surveyId"        TEXT,
  "email"           TEXT NOT NULL,
  "reason"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","surveyId","email")
);
CREATE INDEX IF NOT EXISTS "survey_unsubs_org_email_idx" ON "survey_unsubscribes"("organizationId","email");
