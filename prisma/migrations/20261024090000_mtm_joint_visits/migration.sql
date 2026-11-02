-- Joint visit (owner, 2026-10-20): «менеджер может идти с агентом вместе к
-- клиенту… во время визита менеджер мог оценивать работу агента».
--
-- * mtm_joint_field_sessions — a manager says from the phone that he is in the
--   field with one agent of his team today.
-- * mtm_visit_participants.jointSessionId — the agent answered «yes, together»
--   at check-in: the manager's OBSERVER row on that visit points at the session.
-- * mtm_visit_evaluations — the manager's 1..5 rating of the agent's work on
--   such a visit. The agent never reads it.
--
-- The policies read `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).
--
-- Two new tables and one nullable column: no existing row is touched, and the
-- previous build, which knows none of them, never reads them.

SET lock_timeout = '3s';

CREATE TABLE "mtm_joint_field_sessions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "managerAgentId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_joint_field_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_joint_field_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a session joins two cards of its own
  -- organization only.
  CONSTRAINT "mtm_joint_field_sessions_organizationId_managerAgentId_fkey" FOREIGN KEY ("organizationId", "managerAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_field_sessions_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Nobody accompanies himself.
  CONSTRAINT "mtm_joint_field_sessions_two_people_check" CHECK ("managerAgentId" <> "agentId"),
  CONSTRAINT "mtm_joint_field_sessions_order_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);

CREATE INDEX "mtm_joint_field_sessions_organizationId_managerAgentId_startedAt_idx" ON "mtm_joint_field_sessions"("organizationId", "managerAgentId", "startedAt");
CREATE INDEX "mtm_joint_field_sessions_organizationId_agentId_startedAt_idx" ON "mtm_joint_field_sessions"("organizationId", "agentId", "startedAt");
-- One open session per manager: he is with one agent at a time. Starting with
-- another agent closes the previous session in the same transaction; two
-- presses at once make one session. The database holds this, not a read
-- before the write.
CREATE UNIQUE INDEX "mtm_joint_field_sessions_one_open_per_manager" ON "mtm_joint_field_sessions"("organizationId", "managerAgentId") WHERE "endedAt" IS NULL;

ALTER TABLE "mtm_joint_field_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_joint_field_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_joint_field_sessions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_participants" ADD COLUMN "jointSessionId" TEXT;
ALTER TABLE "mtm_visit_participants"
  ADD CONSTRAINT "mtm_visit_participants_jointSessionId_fkey" FOREIGN KEY ("jointSessionId") REFERENCES "mtm_joint_field_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "mtm_visit_participants_jointSessionId_idx" ON "mtm_visit_participants"("jointSessionId");

CREATE TABLE "mtm_visit_evaluations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "evaluatorAgentId" TEXT NOT NULL,
  "scores" JSONB NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_visit_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_visit_evaluations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_visit_evaluations_organizationId_visitId_fkey" FOREIGN KEY ("organizationId", "visitId") REFERENCES "mtm_visits"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_visit_evaluations_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_visit_evaluations_organizationId_evaluatorAgentId_fkey" FOREIGN KEY ("organizationId", "evaluatorAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_visit_evaluations_scores_check" CHECK (jsonb_typeof("scores") = 'object'),
  CONSTRAINT "mtm_visit_evaluations_comment_check" CHECK ("comment" IS NULL OR char_length("comment") <= 2000)
);

CREATE UNIQUE INDEX "mtm_visit_evaluations_visitId_evaluatorAgentId_key" ON "mtm_visit_evaluations"("visitId", "evaluatorAgentId");
CREATE INDEX "mtm_visit_evaluations_organizationId_agentId_createdAt_idx" ON "mtm_visit_evaluations"("organizationId", "agentId", "createdAt");
CREATE INDEX "mtm_visit_evaluations_organizationId_evaluatorAgentId_createdAt_idx" ON "mtm_visit_evaluations"("organizationId", "evaluatorAgentId", "createdAt");

ALTER TABLE "mtm_visit_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_evaluations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_visit_evaluations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Rollback is forward-safe: roll back the application code and keep the
-- tables and the column. Without the code nothing reads or writes them.
