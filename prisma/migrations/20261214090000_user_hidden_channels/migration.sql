-- Omni-channel numbers and pages an admin hid from one person (owner, 2026-11-11:
-- «в омни канале сделать разрешения… какой-то пользователь может видеть те или
-- иные страницы, которые другой не должен видеть»). A deny list, like
-- "hiddenModules": empty = every channel, so nobody loses anything on deploy.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hiddenChannelConfigIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
