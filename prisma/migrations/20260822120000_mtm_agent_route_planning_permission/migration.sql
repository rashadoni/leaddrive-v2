-- Field agents can be allowed or blocked individually from composing their
-- own route drafts. Existing agents retain the historical behaviour.
ALTER TABLE "mtm_agents"
  ADD COLUMN IF NOT EXISTS "canPlanOwnRoutes" BOOLEAN NOT NULL DEFAULT true;
