-- N3 respond.io parity foundation:
-- - contact-level lifecycle stage (Contact already had tags)
-- - conversation-level inbox tags/labels
-- Additive and dark: no live message send/ingest behavior changes.

ALTER TABLE "contacts"
  ADD COLUMN "lifecycleStage" TEXT NOT NULL DEFAULT 'lead';

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_lifecycleStage_check"
  CHECK ("lifecycleStage" IN (
    'lead', 'engaged', 'mql', 'sql', 'opportunity', 'customer', 'churned'
  ));

CREATE INDEX "contacts_organizationId_lifecycleStage_idx"
  ON "contacts"("organizationId", "lifecycleStage");

ALTER TABLE "social_conversations"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
