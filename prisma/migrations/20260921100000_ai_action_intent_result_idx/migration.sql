-- Roadmap V1.9: find the voice action that produced a CRM record.
--
-- The intent table already links the provider tool call, the voice session,
-- the actor and the record a create produced (`resultEntityType`,
-- `resultEntityId`). What it could not do is answer the question an audit
-- actually asks — "where did this lead come from?" — without a full scan,
-- because only the record an action ACTS ON (`targetEntityId`) was indexed.
--
-- A plain index on a small, new table. Not a backfill, so the RLS
-- snapshot/disable/restore procedure for data migrations does not apply.
CREATE INDEX "ai_action_intents_org_result_idx"
  ON "ai_action_intents"("organizationId", "resultEntityType", "resultEntityId");
