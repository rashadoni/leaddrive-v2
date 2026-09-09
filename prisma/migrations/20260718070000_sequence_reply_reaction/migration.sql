-- E2 (Creatio 10X roadmap): per-sequence reply reaction (stop|pause|continue).
-- Expand-only: nullable column, null = legacy exitOnReply-derived behavior.
SET lock_timeout = '3s';
ALTER TABLE "sales_sequences" ADD COLUMN "replyReaction" TEXT;
