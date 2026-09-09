-- A2 (Creatio 10X roadmap) — web-chat AI reply policy: draft-for-review mode and the
-- auto-send confidence threshold (A1 judge total). Expand-only, defaults preserve behavior.
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "aiDraftMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "aiThreshold" DOUBLE PRECISION;
