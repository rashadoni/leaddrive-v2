# RLS rollout to core tenant tables — execution plan

**Goal:** extend Postgres Row-Level Security (already on ~11 tables) to the core tenant
tables so cross-tenant isolation is DB-enforced, not just app-level `where: organizationId`
discipline. This closes the residual IDOR risk: a forgotten org filter can no longer leak
another tenant's rows.

## Facts / mechanism (already in place)
- ~380 Prisma models carry `organizationId`; only ~11 have RLS policies today.
- Per-transaction context is set in `src/lib/prisma.ts`:
  - tenant: `SELECT set_config('app.org_id', <orgId>, true)`
  - bypass: `SELECT set_config('app.rls_bypass', 'on', true)` (via `runWithRlsBypass`)
- Runtime guard **`[RLS-GUARD]`** in `src/lib/prisma.ts` (~line 135) already `console.warn`s
  whenever a query runs with NO RLS context. **This is the audit tool.**
- ~366 files use `runWithRlsBypass` (cron, webhooks, auth bootstrap, admin). These must stay
  correctly wrapped once core RLS is on.

## The risk (why phased)
RLS is **fail-closed**. After `FORCE ROW LEVEL SECURITY`, any query where `app.org_id` is unset
AND bypass is off returns **0 rows / rejects writes**. So any un-wrapped code path (cron,
webhook, background job, admin) touching an RLS'd table breaks silently. Correctness matters —
this is a security mechanism.

## Migration template (our convention — copy per table)
```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "<table>";
CREATE POLICY tenant_isolation ON "<table>"
  USING      ("organizationId" = current_setting('app.org_id', true)
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true)
              OR current_setting('app.rls_bypass', true) = 'on');
```
Reference an existing example: `prisma/migrations/20260629130000_social_mention_ai_drafts/migration.sql`.

## Phases

### Phase 0 — Audit (no prod change; SAFE)
1. Run the FULL vitest suite and a smoke pass; collect every `[RLS-GUARD]` warning. Each is an
   un-wrapped query path that would break. Wrap each in `runWithTenant(orgId, …)` (tenant work)
   or `runWithRlsBypass(…)` (legit cross-tenant/bootstrap work) BEFORE enabling RLS on its table.
2. Produce the first-tranche core-table list (~10–15): contacts, companies, deals, leads,
   tickets, tasks, invoices, quotes (+ obvious children). NOT all 380.
3. Deliverable: a report of (a) un-wrapped paths found + fixes, (b) the ordered table list.

### Phase 1 — Canary (1 low-traffic table)
- Pick a low-traffic table first (e.g. `quotes` or `tasks`), NOT contacts/deals.
- Apply the migration, run the full suite + smoke, watch for 0-row anomalies / `[RLS-GUARD]` /
  errors. (Postgres has no "report-only" RLS; canary + test coverage is the equivalent.)

### Phase 2 — Roll out one table at a time
- One migration per table (template above). Deploy, watch logs (`[RLS-GUARD]`, error rate,
  support signals) for ~a day, then the next.
- Order: canary (quotes/tasks) → medium (companies, leads, tickets) →
  **highest-traffic (contacts, deals, invoices) LAST, and only after an Opus/Codex review.**

### Phase 3 — Guardrail
- Flip `[RLS-GUARD]` from warn to a **test-failing assertion in the test env** so future
  un-wrapped queries are caught in CI, not prod. New tenant tables ship with RLS from day 1.

## Rollback
Instant, non-destructive (no data change): `ALTER TABLE "<t>" DISABLE ROW LEVEL SECURITY;`
or `DROP POLICY tenant_isolation ON "<t>";`.

## Deploy / ops notes (see memory)
- Deploy from `origin/main` (github rashadrahimov/leaddrive-v2). Prod: registered host `13.140.132.245`,
  `/opt/leaddrive-v2`, PM2 `leaddrive-v2`, port 3001.
- **Server `next build` needs `NODE_OPTIONS=--max-old-space-size=4096`** or it OOMs
  (see memory `deploy-build-heap-oom`).
- Migrations run via `npx prisma migrate deploy` on the server as part of deploy.
