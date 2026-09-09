-- A manager grants route self-publication employee by employee. Existing
-- routes, RLS policy, and the organization-wide routeSelfPublish circuit
-- breaker remain unchanged; this is an additive least-privilege grant.
--
-- Existing agents are intentionally backfilled as false. A tenant that had
-- previously enabled routeSelfPublish must explicitly approve each agent,
-- rather than silently retaining a broad publishing privilege.

SET lock_timeout = '3s';

ALTER TABLE "mtm_agents"
  ADD COLUMN IF NOT EXISTS "canSelfPublishRoutes" BOOLEAN NOT NULL DEFAULT false;

-- Rollback is forward-safe: disable the tenant setting or individual grants
-- and roll back application code, but retain this additive authorization
-- column. Dropping it would discard an administrator's explicit decisions.
