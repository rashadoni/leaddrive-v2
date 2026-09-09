# RLS Rollout Runbook (Postgres tenant isolation)

Plan: `docs/superpowers/plans/2026-06-10-postgres-rls-tenant-isolation.md`
Spec: `docs/superpowers/specs/2026-06-10-postgres-rls-tenant-isolation-design.md`
Deploy target: ALWAYS ask which client first (`clients/registry.json`). Shared box first; per-client boxes after soak.

## Where the rollout stands (production, 2026-08-06)

**447 of 461 tenant tables already have RLS enabled** (440 of them FORCE). The
phases below describe the original first-time rollout and are kept for the
procedure, not because production is at Phase 0 — do not read them as "nothing is
enabled yet". The 14 tables still without RLS: `advisor_playbooks`,
`advisor_signal_snapshots`, `business_hours`, `channel_connections`,
`conversation_flows`, `conversation_flow_runs`, `leaderboard_config`,
`leaderboard_snapshots`, `loyalty_redemptions`, `loyalty_rewards`,
`message_snippets`, `team_queues`, `ticket_categories`,
`ticket_closure_requests`.

The count moved from 462/15 to 461/14 on 2026-08-25: `pitch_tokens` was dropped
with the presentation-links feature (`20260825154500_drop_pitch_tokens`) before
it ever got RLS, so it left the backlog by deletion rather than by coverage.

## Source of truth — read before running a batch file

RLS now arrives by **two** paths, and they overlap:

- **Migrations** (`prisma/migrations`) cover 131 of the 461 tenant tables — every
  `mtm_*` table (see `20260806120000_mtm_rls_coverage_completion`, guarded by
  `src/__tests__/mtm-rls-coverage.test.ts`) plus 62 others. These are protected on
  any database built from migrations alone: CI, restored staging, a new region.
- **These batch scripts** are the only thing covering the remaining 331 tables.
  Their RLS exists on production solely because someone ran the SQL by hand; a
  freshly-migrated database has all 331 wide open. Until those tables move into a
  migration, the scripts cannot be retired.

⚠️ **`disable-batch-*.sql` is now destructive beyond its own rollout.** Each middle
batch spans tables whose RLS came from a migration, and `DISABLE ROW LEVEL SECURITY`
strips it just the same. `prisma migrate deploy` will NOT put it back — an applied
migration never re-runs. Rolling back a batch therefore leaves migration-owned
tables unprotected until the statements are re-applied by hand. Prefer the
per-table rollback (`bash scripts/rls/enable-one.sh <table> --rollback`) and reach
for a whole-batch disable only in a real incident.

## Phase 0 — preflight (on the server, BEFORE enabling anything)

1. `psql -h localhost -U hermes -d leaddrive_v2 -c "SELECT tableowner FROM pg_tables WHERE schemaname='public' LIMIT 3"` → confirm owner (FORCE ROW LEVEL SECURITY is required if `hermes` owns the tables; harmless either way).
2. `psql -h localhost -U hermes -d leaddrive_v2 -c "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='hermes'"` → BOTH must be `f` (a superuser / BYPASSRLS role would silently bypass every policy and the whole rollout would be a no-op).
3. `node --version` on the server → if it differs from Node 20, re-run the ALS spike shape against a scratch DB (`createdb rls_spike` — NEVER a production DB; the spike does DDL and creates a `spike_app` role):

   ```bash
   RLS_TEST_DATABASE_URL=postgresql://<admin-role>@localhost:5432/rls_spike \
     node scripts/rls/spike-extension-mechanics.mjs
   ```

   It must print **CHECK0–CHECK6 all PASS**. The script exits non-zero if any check logs FAIL — do NOT proceed past a non-zero exit.
4. `node scripts/rls/generate-rls-policies.mjs --dry-run` → table count ≈460, batch composition sane, batch-1 = low-risk lookups (currencies / task_types / event_types / sla_policies / task_templates), final batch = `users` / `api_keys` / `otp_codes`.

   Regenerate (step 1 of Phase 2) BEFORE running any batch file. The committed SQL
   is a snapshot: tables dropped since the last generation abort the batch at the
   first `ALTER TABLE` on a missing table, and tables added since are silently left
   unprotected. Last regenerated 2026-08-06 against production: **462 tenant tables,
   `5 + 152 + 152 + 150 + 3`**. Since then batch-4 was hand-edited once, on
   2026-08-25, to delete the `pitch_tokens` stanza when that table was dropped —
   exactly the "aborts on a missing table" case above, pre-empted rather than
   discovered at run time. Committed composition is therefore
   `5 + 152 + 152 + 149 + 3`; a regeneration supersedes both numbers.

## Phase 1 — ship plumbing (RLS enabled on ZERO tables)

Deploy the branch normally (standalone-build gotchas per `CLAUDE.md`: copy `.next/static`, `public/*`, Prisma engine). Pure no-op for the DB.

Soak ≥1 day: watch PM2 logs for `[rls]` dev-warnings (should be none in prod mode), login/cron/webhook behavior unchanged. `/api/v1/ping` → `{"ok":true}`.

## Phase 2 — batch 1 (5 low-risk tables)

1. `node scripts/rls/generate-rls-policies.mjs` (writes `scripts/rls/enable-batch-N.sql` + `disable-batch-N.sql`, and deletes any higher-numbered pair left over from a previous, larger run) — commit the generated SQL.
2. `psql -h localhost -U hermes -d leaddrive_v2 -f scripts/rls/enable-batch-1.sql`
3. Smoke on demo tenants (mars, afigroup): login, sidebar, settings pages backed by those lookup tables, one cron via curl, one public survey page.
4. Symptom of a missed surface = EMPTY LIST where data exists (fail-closed, not a leak). Rollback: `psql … -f scripts/rls/disable-batch-1.sql` (instant, no data movement).

## Phase 3 — middle batches (2…N-1)

Enable one batch at a time; between batches run the demo-tenant smoke: login, leads/deals/contacts CRUD, inbox, notifications, exports, one manual cron, one webhook, MTM mobile sync.

A middle batch is ~150 tables, so a failed smoke gives you no idea which table broke.
When a batch does go wrong, roll it back and re-approach table-by-table with
`scripts/rls/enable-one.sh` (per-table preflight + auto-rollback) rather than
re-running the batch.

## Phase 4 — final batch (`users`, `api_keys`, `otp_codes`) — auth-critical

Enable last, off-peak. IMMEDIATELY verify: credentials login, OAuth login, API-key call, mobile JWT call, cron, superadmin `/admin/tenants`. Keep the rollback file ready in the same terminal.

## Phase 5 — soak before zeytunpharm

Full E2E pass + one week of normal demo-tenant usage with clean logs; only then onboard live-client data.

## Residual risks (accepted, documented)

- Session-var bypass is defeatable by SQL injection — RLS here defends against app-logic bugs (forgotten `where organizationId`), not injection; app layers remain the injection defense (spec §9).
- FK existence can leak via constraint errors; `TRUNCATE` bypasses RLS; `organizations` is a global table (no `organizationId` column → no policy).
- Upgrade path if an auditor demands injection-resistant isolation: two-role split (spec D1 alternative).
