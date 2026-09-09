ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "ticketId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'call_logs_ticketId_fkey'
  ) THEN
    ALTER TABLE "call_logs"
      ADD CONSTRAINT "call_logs_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "call_logs_organizationId_ticketId_idx"
  ON "call_logs"("organizationId", "ticketId");
