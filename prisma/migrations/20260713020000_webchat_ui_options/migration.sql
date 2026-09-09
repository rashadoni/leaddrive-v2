-- Whelp-style web-chat widget options (onboarding questions on/off + field builder,
-- history restore on/off). Expand-only: nullable JSONB, null = current behavior.
ALTER TABLE "web_chat_widgets" ADD COLUMN IF NOT EXISTS "uiOptions" JSONB;
