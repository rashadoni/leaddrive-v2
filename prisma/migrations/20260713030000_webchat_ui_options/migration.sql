-- Whelp-style web-chat widget options: master onboarding toggle, history restore,
-- custom "know your customer" questions. Expand-only: nullable JSONB, NULL = current behavior.
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "uiOptions" JSONB;
