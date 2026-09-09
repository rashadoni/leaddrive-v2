-- One automatic callback per broken call, enforced by the database.
--
-- The unique index is the whole point. Application-level "have we already
-- called back?" checks lose to concurrency: a duplicated webhook, a retried
-- handler and a crash between read and write all produce two callbacks, and
-- the customer's phone rings twice. A unique constraint cannot.
--
-- ON DELETE SET NULL rather than CASCADE: deleting an original call must not
-- silently delete the record of the callback that was already placed.
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "continuesCallId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "call_logs_continuesCallId_key"
  ON "call_logs" ("continuesCallId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_continuesCallId_fkey'
  ) THEN
    ALTER TABLE "call_logs"
      ADD CONSTRAINT "call_logs_continuesCallId_fkey"
      FOREIGN KEY ("continuesCallId") REFERENCES "call_logs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
