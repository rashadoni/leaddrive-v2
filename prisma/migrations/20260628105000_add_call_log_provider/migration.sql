-- Fresh-install compatibility: provider was present in deployed call_logs via
-- schema bootstrap, while the provider-session migration indexed it without
-- adding the column.
ALTER TABLE "call_logs"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'twilio';
