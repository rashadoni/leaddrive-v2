-- Marks when a callback's continuation context was first handed to the PBX.
-- Nullable: never served is the normal state for every ordinary call.
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "continuationServedAt" TIMESTAMP(3);
