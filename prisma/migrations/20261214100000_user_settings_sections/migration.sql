-- Sections of Settings an admin handed to one person without the admin role
-- (owner, 2026-11-11: «чтоб видел конкретные разделы параметров»). An ALLOW
-- list: empty = what the role gives, so nobody gains or loses anything on deploy.
-- Catalog and enforcement: src/lib/settings-sections.ts.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "settingsSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
