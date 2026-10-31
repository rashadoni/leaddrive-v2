-- The language the agent's phone app shows, reported by the app. Nullable, no
-- backfill: until the app reports it, text for the agent keeps its CRM login's
-- language (src/lib/mtm/agent-language.ts).
ALTER TABLE "mtm_agents" ADD COLUMN "appLanguage" TEXT;
