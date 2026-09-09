-- A3 (Creatio 10X roadmap) — audience rollout for web-chat AI replies: share of sessions
-- the AI answers (deterministic per session). Expand-only; NULL = everyone (pre-A3 behavior).
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "aiRolloutPercent" INTEGER;
