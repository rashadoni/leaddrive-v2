# RLS core-tenant-tables rollout — execution runbook

Companion to `docs/rls-rollout-plan.md` (strategy for extending RLS to the core
CRM tables). For the ORIGINAL batch-based RLS introduction and the server-role
preflight (the `hermes` role must be `NOSUPERUSER` + `NOBYPASSRLS`, else every
policy is silently bypassed), see the earlier `docs/rls-rollout-runbook.md`.

## State as of 2026-07-09 (start of the final-tranche session)

**No core tenant table had RLS yet.** The plan document existed but no
canary/medium/hot tranche had been applied — `origin/main` contained zero RLS
rollout commits after the plan. RLS was live only on the ~13 pre-existing tables
(social/contract/call/entitlement/monitoring), none of which are core CRM tables.

Implication: the highest-traffic tables (contacts/deals/invoices) must **not** be
enabled first. The canary → medium → hot ordering exists precisely so the
fail-closed mechanism is proven on low-traffic core tables before the hot ones.

## Phase 0 audit result (contacts / deals / invoices) — CLEAN

Code paths for all three tables are correctly wrapped:

- `scripts/rls/find-context-gaps.py` → **0 gaps** across all 382 org-scoped
  models (route-level + single + recursive lib-delegation).
- RLS gate tests green: `rls-route-context-coverage`, `rls-context-gaps-finder`,
  `rls-bypass-classifier` (crons/scripts/public/admin/webhooks + no stray
  `new PrismaClient`), `lib-prisma-rls-extension`, `admin-pages-rls-scope`,
  `public-pages-rls-scope`, `api-webhooks-rls-scope`.
- Non-route entrypoints touching these tables verified wrapped:
  `src/instrumentation.ts` finance cron (`invoice.updateMany` → `runWithRlsBypass`),
  `src/app/admin/page.tsx` (`contact/deal.count` → `runWithRlsBypass`), the
  marketing-attribution worker (only reached from route/cron entrypoints), and
  no `"use server"` action touches these tables.
- `organizationId` is `NOT NULL` on Contact/Deal/Invoice → no rows are hidden by
  the policy after enable.

**GO/NO-GO:** code readiness is **GO** for contacts, deals, and invoices. They
still go **LAST** per the ordering below — do not skip the canary/medium tranches.

## Ordered rollout

All ENABLE migrations are now committed (one per table). They are ordered by
timestamp so they apply canary → medium → hot:

| Order | Table | Migration |
|------:|-------|-----------|
| Canary | `quotes` | `20260709120000_enable_rls_quotes_canary` |
| Medium | `companies` | `20260709120100_enable_rls_companies` |
| Medium | `leads` | `20260709120200_enable_rls_leads` |
| Medium | `tickets` | `20260709120300_enable_rls_tickets` |
| Hot | `contacts` | `20260709120400_enable_rls_contacts` |
| Hot | `deals` | `20260709120500_enable_rls_deals` |
| Hot | `invoices` | `20260709120600_enable_rls_invoices` |

One table per step. After each, watch for ~a day before the next.

> **Historical rollout note:** the former manual `scripts/deploy.sh` path has
> been retired because it skipped `prisma migrate deploy`. Current production
> releases use the GitHub Actions artifact and `scripts/server-deploy.sh`, which
> applies migrations under the isolated migration role and verifies their
> postconditions. Do not combine the legacy per-table commands below with an
> in-flight automated release; treat them as incident/manual-rollout procedures
> requiring explicit DBA approval.

### Controlled per-table apply (keeps the cadence)

Use the helper `scripts/rls/enable-one.sh` **on the server** — it runs the role
preflight (aborts if the DB role is superuser / bypassrls, which would make RLS a
silent no-op), applies the idempotent ENABLE + policy, and prints the resulting
state. It resolves the DB URL from `$DBURL` / `$DATABASE_URL` / the app `.env`.

```bash
cd /opt/leaddrive-v2
bash scripts/rls/enable-one.sh quotes          # canary first
# watch ~a day: pm2 logs leaddrive-v2 | grep RLS-GUARD  + error rate
bash scripts/rls/enable-one.sh companies        # then medium, one at a time
bash scripts/rls/enable-one.sh leads
bash scripts/rls/enable-one.sh tickets
bash scripts/rls/enable-one.sh contacts         # then hot, one at a time
bash scripts/rls/enable-one.sh deals
bash scripts/rls/enable-one.sh invoices
```

Check state without changing anything, and instant rollback:

```bash
bash scripts/rls/enable-one.sh contacts --status
bash scripts/rls/enable-one.sh contacts --rollback   # DISABLE RLS + drop policy
```

Equivalent raw SQL (if you prefer psql directly) is each table's
`prisma/migrations/*_enable_rls_<table>/migration.sql`.

**Batch (all remaining tables in one run):** `scripts/rls/enable-rest.sh` enables
the remaining tables in order, and after each one waits + greps the server logs
for a table-specific `[RLS-GUARD]`; on a hit it auto-rolls-back that table and
stops. The log check is light (only sees paths real traffic exercised in the
wait), so for the hot tables prefer a longer soak:

```bash
bash scripts/rls/enable-rest.sh companies leads tickets    # medium first
RLS_WAIT_SECONDS=3600 bash scripts/rls/enable-rest.sh contacts deals invoices  # hot, 1h between
```

## Per-table checklist (repeat for each table, in order)

1. **Pre-flight (once, before the rollout):**
   - `python3 scripts/rls/find-context-gaps.py` → `RLS-CONTEXT GAPS: 0`
   - `npx tsc --noEmit` → clean, `npx vitest run` → green (the Phase 3 guardrail
     fails CI on any un-wrapped org query at runtime).
   - The migration SQL is proven correct on a real Postgres (fail-closed,
     isolation, bypass, WITH CHECK) — the `enable-one.sh` role preflight covers
     the remaining server-side condition (role is `NOSUPERUSER`/`NOBYPASSRLS`).
2. **Enable** on the server: `bash scripts/rls/enable-one.sh <table>` (or apply the
   table's `migration.sql` via psql).
3. **Monitor ~a day:**
   - `[RLS-GUARD]` in server logs (`pm2 logs leaddrive-v2 | grep RLS-GUARD`) — any
     hit is an un-wrapped path now fail-closing; roll back that table and wrap it.
   - error rate + support signals for empty-list / 0-row anomalies.
4. **Only then** move to the next table.

## Rollback (instant, non-destructive — no data change)

```sql
ALTER TABLE "<table>" DISABLE ROW LEVEL SECURITY;   -- or
DROP POLICY tenant_isolation ON "<table>";
```

## Phase 3 guardrail (shipped this session)

`src/lib/prisma.ts` — the `[RLS-GUARD]` runtime hook now **throws in the test
env** (`RLS_GUARD_THROW`) when an org-scoped *model* op runs with no RLS context,
instead of only `console.warn`. So a future un-wrapped query the static
gap-finder can't see (class-method helper, `tx.<model>` in an interactive txn,
dynamic dispatch) fails CI instead of fail-closing in prod. Raw
`$queryRaw/$executeRaw` stay warn-only (the guard can't prove the table is
org-scoped). Dev/prod behaviour is unchanged (observe-only warn). Setting
`RLS_TEST_DATABASE_URL` opts out so the real-DB fail-closed repro can still run.

## Deferred / not done

- **Not applied to prod here** — all 7 ENABLE migrations are committed, but this
  session cannot deploy to prod or watch live logs. Apply them one table at a time
  using the controlled per-table procedure above, canary → medium → hot, watching
  `[RLS-GUARD]` + error rate between each.
- **Orphaned `LandingPage`/`PageView` models/tables** remain inert (0 rows) per
  the decision in commit `200031d`; dropping them is a separate destructive
  migration, out of scope here.
