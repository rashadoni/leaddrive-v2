-- Drop pitch_tokens together with the presentation-links feature ("Prezentasiya
-- linkləri"), whose entire surface — settings page, /pitch/[token] guest viewer,
-- /api/v1/pitch* routes, upload storage helper, help article and tour — is
-- removed in this change. Owner decision 2026-08-25: drop WITHOUT data export.
-- The rows are one-time guest share links for a retired feature; nothing else
-- reads them.
--
-- DDL only: no snapshot/disable/restore dance (that pattern is for RLS-hidden
-- row backfills). This table is one of the 15 prod tenant tables that never got
-- RLS enabled, so there is no tenant_isolation policy to detach here — CASCADE
-- covers it regardless, along with the unique index on "token" and the
-- organizationId index. The only FK (pitch_tokens.organizationId →
-- organizations.id) lives on the dropped side, so `organizations` needs no
-- ALTER. IF EXISTS keeps the file idempotent — Prisma Migrate does not
-- guarantee a per-file transaction on Postgres, so a mid-file retry must be
-- safe, and environments where the table was never created must not fail.
--
-- RUNBOOK if this migration fails on deploy (e.g. lock_timeout while another
-- session holds a lock on the table): the failed row wedges every subsequent
-- `prisma migrate deploy` with P3009. Because the file is idempotent, the fix
-- is:
--   npx prisma migrate resolve --rolled-back 20260825154500_drop_pitch_tokens
-- then redeploy. The DROP is a single statement, so a lock timeout rolls it
-- back atomically — no partial table state.

SET lock_timeout = '3s';

DROP TABLE IF EXISTS "pitch_tokens" CASCADE;

-- SET lock_timeout is session-scoped and `migrate deploy` reuses one connection
-- across pending migrations — don't leak the 3s budget into a later migration
-- in the same run.
RESET lock_timeout;
