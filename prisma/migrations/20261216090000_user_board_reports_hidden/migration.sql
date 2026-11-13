-- A board's «Hesabatlar» tab closed for one person (owner, 2026-11-13: «нужно
-- ограничивать доступ к отчётам пользователям. Чтоб только кому доступен он мог
-- видеть» — the reports name every colleague's numbers). A DENY flag, like
-- "hiddenModules": false = sees them, so nobody loses anything on deploy.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boardReportsHidden" BOOLEAN NOT NULL DEFAULT false;
