-- Leads created from Inbox before the full handoff card was introduced can
-- have an empty "interest" field even though the linked conversation already
-- contains the customer's need. Backfill only empty values and keep every
-- manually entered value untouched.
UPDATE "leads" AS lead
SET "interest" = LEFT(
  COALESCE(
    NULLIF(BTRIM(conversation."aiCustomerStageReason"), ''),
    NULLIF(BTRIM(conversation."lastMessage"), '')
  ),
  2000
)
FROM "social_conversations" AS conversation
WHERE conversation."organizationId" = lead."organizationId"
  AND conversation."metadata"->>'qualificationLeadId' = lead."id"
  AND NULLIF(BTRIM(lead."interest"), '') IS NULL
  AND COALESCE(
    NULLIF(BTRIM(conversation."aiCustomerStageReason"), ''),
    NULLIF(BTRIM(conversation."lastMessage"), '')
  ) IS NOT NULL;
