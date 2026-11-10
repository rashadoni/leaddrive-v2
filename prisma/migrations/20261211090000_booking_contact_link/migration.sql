-- Staff booking a customer who is already in the CRM links the meeting to that
-- contact instead of creating one more lead for the same person. One nullable
-- column, no foreign key: a release that does not know it reads every meeting
-- exactly as before.
SET lock_timeout = '3s';

ALTER TABLE "bookings"
  ADD COLUMN "contactId" TEXT;

CREATE INDEX IF NOT EXISTS "bookings_org_contact_idx" ON "bookings" ("organizationId", "contactId");
