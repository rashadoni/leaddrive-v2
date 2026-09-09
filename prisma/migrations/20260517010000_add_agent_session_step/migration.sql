-- H1 Agent framework (Phase 3 roadmap slice 1).
-- AgentSession threads one user goal through a planning loop.
-- AgentStep records each iteration (observe → think → act → respond).

CREATE TABLE "agent_sessions" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentConfigId"  TEXT NOT NULL,
    "agentName"      TEXT NOT NULL,
    "goal"           TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'planning',
    "contextType"    TEXT,
    "contextId"      TEXT,
    "result"         TEXT,
    "stepCount"      INTEGER NOT NULL DEFAULT 0,
    "maxSteps"       INTEGER NOT NULL DEFAULT 20,
    "budgetUsd"      DOUBLE PRECISION,
    "costSoFarUsd"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "initiatedBy"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "completedAt"    TIMESTAMP(3),

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_sessions_organizationId_status_idx" ON "agent_sessions"("organizationId", "status");
CREATE INDEX "agent_sessions_agentConfigId_idx" ON "agent_sessions"("agentConfigId");

ALTER TABLE "agent_sessions"
    ADD CONSTRAINT "agent_sessions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status must be one of the engine-supported values.
ALTER TABLE "agent_sessions"
    ADD CONSTRAINT "agent_sessions_status_check"
    CHECK ("status" IN ('planning', 'executing', 'waiting_input', 'completed', 'failed', 'cancelled'));

CREATE TABLE "agent_steps" (
    "id"           TEXT NOT NULL,
    "sessionId"    TEXT NOT NULL,
    "stepIndex"    INTEGER NOT NULL,
    "kind"         TEXT NOT NULL,
    "observation"  TEXT,
    "thought"      TEXT,
    "action"       TEXT,
    "toolName"     TEXT,
    "toolInput"    JSONB,
    "toolOutput"   JSONB,
    "outcome"      TEXT NOT NULL DEFAULT 'ok',
    "errorMessage" TEXT,
    "costUsd"      DOUBLE PRECISION,
    "latencyMs"    INTEGER,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_steps_sessionId_stepIndex_key" ON "agent_steps"("sessionId", "stepIndex");
CREATE INDEX "agent_steps_sessionId_idx" ON "agent_steps"("sessionId");

ALTER TABLE "agent_steps"
    ADD CONSTRAINT "agent_steps_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_steps"
    ADD CONSTRAINT "agent_steps_kind_check"
    CHECK ("kind" IN ('observe', 'think', 'act', 'respond'));

ALTER TABLE "agent_steps"
    ADD CONSTRAINT "agent_steps_outcome_check"
    CHECK ("outcome" IN ('ok', 'error', 'deferred'));
