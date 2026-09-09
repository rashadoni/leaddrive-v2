-- Autonomous Inbox AI-agent controls.
--
-- Existing tenants stay fail-closed: neither backlog processing nor automatic
-- lead creation is activated by this migration. Administrators opt in after
-- selecting the destination marketing board in Inbox AI-agent settings.
ALTER TABLE "ai_agent_configs"
  ADD COLUMN "autoLeadEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoAssignSales" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autonomousBacklogEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autonomousLookbackDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "autonomousBatchSize" INTEGER NOT NULL DEFAULT 20;
