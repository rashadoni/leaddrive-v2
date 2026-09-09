-- Pre-chat form config for the web chat widget (per-field enabled/required).
-- Nullable, no default, no backfill: NULL = legacy behavior (all fields shown,
-- none required). web_chat_widgets is under FORCE RLS — lock_timeout guards the
-- ALTER against blocking behind long transactions (fail-fast + deploy retry).
SET lock_timeout = '3s';
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "preChatForm" JSONB;
