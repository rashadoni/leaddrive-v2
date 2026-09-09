-- AiAgentConfig.temperature default 1.0 → 0.7, to match the engine fallback
-- (lib/social/ai-autoreply.ts) and the persona editor default. Only affects FUTURE rows
-- created without an explicit temperature (e.g. a direct API create); existing agents keep
-- their stored value — no backfill (their values are intentional, the editor always sends one).
ALTER TABLE "ai_agent_configs" ALTER COLUMN "temperature" SET DEFAULT 0.7;
