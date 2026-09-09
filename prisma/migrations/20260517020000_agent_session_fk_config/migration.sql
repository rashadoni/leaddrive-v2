-- H1 follow-up: add FK from agent_sessions.agentConfigId to ai_agent_configs.id.
-- Prior migration committed the column as plain text — this enforces
-- referential integrity. ON DELETE RESTRICT: agent configs are rarely
-- removed; an explicit error is preferable to silent orphan sessions.

ALTER TABLE "agent_sessions"
    ADD CONSTRAINT "agent_sessions_agentConfigId_fkey"
    FOREIGN KEY ("agentConfigId") REFERENCES "ai_agent_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
