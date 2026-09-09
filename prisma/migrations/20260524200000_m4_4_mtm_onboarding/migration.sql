-- M4-4: MtmOnboarding table — per-agent first-time onboarding progress tracker
--
-- One row per agent. completedSteps is a JSON string array of step IDs.
-- completedAt is set server-side when all 5 canonical steps are complete.
--
-- API: GET/PUT /api/v1/mtm/onboarding
-- Steps: profile_complete, first_checkin, first_photo, first_order, tutorial_video_watched

CREATE TABLE "mtm_onboarding" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "completedSteps"  TEXT NOT NULL DEFAULT '[]',
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_onboarding_pkey" PRIMARY KEY ("id")
);

-- Unique: one onboarding record per agent
CREATE UNIQUE INDEX "mtm_onboarding_agentId_key"
  ON "mtm_onboarding" ("agentId");

-- FK: organizationId → organizations.id
ALTER TABLE "mtm_onboarding"
  ADD CONSTRAINT "mtm_onboarding_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: agentId → mtm_agents.id
ALTER TABLE "mtm_onboarding"
  ADD CONSTRAINT "mtm_onboarding_agentId_fkey"
  FOREIGN KEY ("agentId")
  REFERENCES "mtm_agents" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Support listing all onboarding records for an org (admin overview)
CREATE INDEX "mtm_onboarding_organizationId_idx"
  ON "mtm_onboarding" ("organizationId");
