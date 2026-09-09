# Postgres RLS — DB-Enforced Tenant Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Postgres Row-Level Security under the existing app-level isolation so the database itself refuses cross-tenant rows, with zero route-body edits, fail-closed semantics, batched per-table rollout and instant rollback.

**Architecture:** AsyncLocalStorage carries `{orgId|bypass}` per request; a Prisma client extension (top-level `$allOperations` + `$transaction` override via Proxy) injects `set_config('app.org_id'|'app.rls_bypass', …, true)` on the same connection as each query; policies (`USING` + `WITH CHECK`) are generated per table from `information_schema`. Cross-tenant surfaces (auth bootstrap, superadmin, crons, scripts, webhooks, public pages, instrumentation timers) are explicitly classified and guarded; a CI classifier test keeps the inventory total.

**Tech Stack:** Next.js 16.1.7 (Node runtime), Prisma 6.19.2, PostgreSQL (single DB `leaddrive_v2`, user `hermes`), vitest 4.1.2, Node 20 (CI `NODE_VERSION: "20"`, local spike verified on v20.20.2).

**Spec:** `docs/superpowers/specs/2026-06-10-postgres-rls-tenant-isolation-design.md` (v2, architect-approved). Branch: `feat/rls-tenant-isolation`.

---

## Design addenda locked into this plan (architect invariants + Codex review 2026-06-10)

These amend/sharpen the spec and are **binding** for every task below:

1. **`enterWith` ONLY on the per-request HTTP path** (inside `requireAuth`/`getOrgId`/`requireSuperAdmin`/`requireCronAuth`). Everything that loops or ticks (`setInterval` in `instrumentation.ts`, scripts' main loops) MUST use `.run()`-based wrappers (`runWithTenant`/`runWithRlsBypass`). Empirically verified on Node v20.20.2: `enterWith` inside an awaited callee **does** propagate to the caller's continuation (both `await` and `.then` shapes), and **does** leak across `setInterval` ticks. Both behaviors are pinned by unit tests in Task 1.
2. **Cron-auth choke point = new shared `requireCronAuth()`** in `src/lib/cron-auth.ts` (constant-time compare — `journeys/process` already used `timingSafeEqual`; the choke point must not downgrade it). No shared guard exists today: 34 `/api/cron/*` routes carry inline checks, plus 2 cron-shaped routes outside (`social/cron/poll-all`, `journeys/process`) adopt the guard; `webhooks/meeting-recap` is NOT cron — it authenticates with its own `x-meeting-webhook-secret` (`MEETING_WEBHOOK_SECRET || CRON_SECRET` fallback) and is classified as a webhook (Task 10) with a classifier allowlist (Task 11). The classifier test is written against this choke point.
3. **Codex second opinion (obtained 2026-06-10, threadId `019eb04e-bc6f-74d0-85de-45cf8da52704`) — findings folded in:**
   - **Auth bootstrap queries run BEFORE any ALS context exists** — `auth()` (NextAuth + `PrismaAdapter(prisma)` at `src/lib/auth.ts:17`), API-key lookup, mobile-JWT resolution, password-changed check, jwt-callback refresh. All hit `users`/`api_keys` which WILL get policies. Every one of them is bypass-wrapped in Task 6, and `users`/`api_keys` go in the **final** rollout batch.
   - **Empty string is not NULL**: `AuthResult.orgId` is built as `session.user.organizationId || ""`. `enterTenantContext("")` must refuse to enter context (fail-closed + dev warning) — otherwise the policy would match rows with empty-string `organizationId`.
   - **Interactive-tx hooks:** query extensions do NOT apply to the `tx` client inside interactive transactions (already relied upon by `src/lib/project-rollup.ts:60` and pinned by `src/__tests__/lib-prisma-soft-delete.test.ts`). Isolation inside interactive txs therefore comes from `set_config` injected at tx open — the `inTx` flag is a safety/pass-through for the batch path.
   - **Batch (`$transaction([...])`) ALS timing is UNPROVEN from docs** — whether per-item extension hooks execute inside our `als.run({inTx:true})` scope needs a live Prisma 6.19.2 spike (Task 2). Deterministic fallback if the spike fails: convert the 14 batch callsites (9 prod files) to interactive form and make the override throw on array form when tenant context is set.
   - **Postgres residuals (documented, accepted):** FK/referential-integrity checks bypass RLS (existence can leak via constraint errors); `TRUNCATE` is not subject to RLS; superusers and `BYPASSRLS` roles bypass everything — runbook checks `hermes` for both. `organizations` has no `organizationId` column → it is a **global table, never gets a policy** (org-slug/status lookups are unaffected by RLS).
4. **Fail-closed everywhere:** no context → `current_setting(..., true)` is NULL → zero rows, never a leak. Dev-mode `console.warn` on tenant-table queries with no context.

## Execution environment (read first)

- Work in the existing worktree `/private/tmp/claude-501/ld-rls` on branch `feat/rls-tenant-isolation` (recreate with `git worktree add /private/tmp/claude-501/ld-rls feat/rls-tenant-isolation` if wiped). **Never touch the main repo working tree** (parallel sessions).
- `node_modules`: clone from main repo via APFS: `cp -cR /Users/rashadrahimov/Documents/leaddrive-v2/node_modules /private/tmp/claude-501/ld-rls/node_modules` (fast, copy-on-write).
- TypeScript check needs memory: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`.
- Full-suite pre-existing failure baseline = **5** (4 FB/IG OAuth-state + 1 api-offers jsPDF). Anything beyond that is yours.
- Integration tests need a scratch Postgres: `docker run -d --name rls-pg -e POSTGRES_PASSWORD=rls -p 55432:5432 postgres:16` → `RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres`. Tests skip cleanly when the env var is unset (CI stays green without a DB).
- Commit after every task; do NOT push `main`; push `feat/rls-tenant-isolation` freely.

## File structure (what gets created/modified)

| File | Responsibility |
|---|---|
| `src/lib/rls-context.ts` (new) | ALS store + `runWithTenant`/`runWithRlsBypass`/`enterTenantContext`/`enterRlsBypass`/`getRlsContext` |
| `src/lib/prisma.ts` (modify) | RLS extension (per-op wrap) + `$transaction` override Proxy, chained after the soft-delete extension; `tenantPrisma` re-based |
| `src/lib/cron-auth.ts` (new) | `requireCronAuth()` — shared cron guard + bypass entry (choke point) |
| `src/lib/api-auth.ts` (modify) | bypass-wrap 4 bootstrap lookups; `enterTenantContext` at every success return of `requireAuth`/`getOrgId` |
| `src/lib/superadmin-guard.ts` (modify) | `enterRlsBypass()` after role check |
| `src/lib/auth.ts` (modify) | `bypassAdapter(PrismaAdapter(prisma))`; bypass-wrap authorize/signIn/jwt prisma calls |
| `src/lib/mobile-auth.ts` (modify) | bypass-wrap the 2 agent-resolution lookups |
| `src/instrumentation.ts` (modify) | finance + MTM ticks → shared `prisma` + `runWithRlsBypass` per tick (`.run()` semantics) |
| `scripts/_rls.mjs` (new) | `makeScriptPrisma()` — connection_limit=1 + session-level set_config |
| `scripts/rls/generate-rls-policies.mjs` (new) | introspect `information_schema` → `enable-batch-N.sql` / `disable-batch-N.sql` |
| `scripts/rls/spike-extension-mechanics.mjs` (new) | self-contained Prisma 6.19.2 mechanics spike (Task 2 gate) |
| 34 × `src/app/api/cron/*/route.ts` + 2 cron-shaped routes (modify) | adopt `requireCronAuth` (meeting-recap → webhook sweep, row below) |
| 46 × `scripts/*` with own client (modify) | adopt `makeScriptPrisma()` |
| ~13 webhook routes + ~8 public pages + 4 admin pages (modify) | bypass-resolve → `runWithTenant` pattern |
| `src/__tests__/lib-rls-context.test.ts` (new) | ALS semantics incl. enterWith propagation + tick leak |
| `src/__tests__/lib-prisma-rls-extension.test.ts` (new) | per-op wrap + tx override unit tests (stub client) |
| `src/__tests__/lib-cron-auth.test.ts` (new) | guard semantics |
| `src/__tests__/rls-policy-generator.test.ts` (new) | SQL emission pure-function tests |
| `src/__tests__/rls-integration.test.ts` (new) | real-PG isolation matrix (env-gated) |
| `src/__tests__/rls-bypass-classifier.test.ts` (new) | totality classifier (CI guarantee) |
| `docs/rls-rollout-runbook.md` (new) | phased enable/rollback/smoke procedure |

Dependency order: Task 1 → Task 2 (gate) → Task 3 → Task 4 → Task 5 → Tasks 6–10 (sweeps) → Task 11 (classifier, must be last code task) → Task 12 (docs).

---

### Task 1: RLS context module (`src/lib/rls-context.ts`)

**Files:**
- Create: `src/lib/rls-context.ts`
- Test: `src/__tests__/lib-rls-context.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/lib-rls-context.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  rlsStorage,
  getRlsContext,
  runWithTenant,
  runWithRlsBypass,
  enterTenantContext,
  enterRlsBypass,
} from "@/lib/rls-context"

describe("rls-context", () => {
  // enterWith deliberately leaks across async continuations (that's the design
  // for HTTP guards) — reset before each test so tests stay order-independent.
  beforeEach(() => { rlsStorage.enterWith(undefined as never) })

  it("runWithTenant scopes orgId to the callback and clears after", async () => {
    expect(getRlsContext()).toBeUndefined()
    const inside = await runWithTenant("org-a", async () => getRlsContext())
    expect(inside).toEqual({ orgId: "org-a" })
    expect(getRlsContext()).toBeUndefined()
  })

  it("runWithTenant throws on empty orgId (fail-closed, never empty-string match)", () => {
    expect(() => runWithTenant("", async () => {})).toThrow(/non-empty/)
  })

  it("runWithRlsBypass sets bypass flag", async () => {
    const inside = await runWithRlsBypass(async () => getRlsContext())
    expect(inside).toEqual({ bypass: true })
  })

  it("nested runWithTenant overrides outer context and restores it", async () => {
    await runWithTenant("org-a", async () => {
      await runWithTenant("org-b", async () => {
        expect(getRlsContext()).toEqual({ orgId: "org-b" })
      })
      expect(getRlsContext()).toEqual({ orgId: "org-a" })
    })
  })

  it("enterTenantContext inside an awaited callee propagates to the caller continuation (guard→handler shape)", async () => {
    // This pins the Node ALS semantics the whole zero-route-edit design rests on.
    async function guard() {
      enterTenantContext("org-guard")
      return "ok"
    }
    async function handler() {
      await guard()
      await new Promise((r) => setTimeout(r, 5)) // cross a real async boundary
      return getRlsContext()
    }
    expect(await handler()).toEqual({ orgId: "org-guard" })
  })

  it("enterTenantContext refuses empty orgId and enters NO context", async () => {
    async function handler() {
      const entered = enterTenantContext("")
      return { entered, ctx: getRlsContext() }
    }
    const r = await handler()
    expect(r.entered).toBe(false)
    expect(r.ctx).toBeUndefined()
  })

  it("enterRlsBypass replaces a previously entered tenant context (superadmin-after-requireAuth shape)", async () => {
    async function handler() {
      enterTenantContext("org-x")
      enterRlsBypass()
      return getRlsContext()
    }
    expect(await handler()).toEqual({ bypass: true })
  })

  it("INVARIANT: enterWith leaks across interval ticks; .run() isolates them", async () => {
    // Documents WHY timers must use runWithRlsBypass (.run), never enterTenantContext.
    const leak: Array<unknown> = []
    await new Promise<void>((resolve) => {
      let tick = 0
      const t = setInterval(() => {
        tick++
        if (tick === 1) rlsStorage.enterWith({ orgId: "tick-1" })
        leak.push(getRlsContext())
        if (tick === 2) { clearInterval(t); resolve() }
      }, 5)
    })
    expect(leak[1]).toEqual({ orgId: "tick-1" }) // the leak — this is the footgun

    const isolated: Array<unknown> = []
    await new Promise<void>((resolve) => {
      let tick = 0
      const t = setInterval(() => {
        tick++
        void runWithRlsBypass(async () => { isolated.push(getRlsContext()) })
        if (tick === 2) { clearInterval(t); resolve() }
      }, 5)
    })
    expect(isolated).toEqual([{ bypass: true }, { bypass: true }])
    expect(getRlsContext()).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /private/tmp/claude-501/ld-rls && npx vitest run src/__tests__/lib-rls-context.test.ts`
Expected: FAIL — `Cannot find module '@/lib/rls-context'`

- [ ] **Step 3: Implement the module**

```ts
// src/lib/rls-context.ts
/**
 * AsyncLocalStorage tenant context for Postgres RLS.
 *
 * The Prisma extension in src/lib/prisma.ts reads this store and injects
 * `set_config('app.org_id' | 'app.rls_bypass', ..., true)` on the same
 * connection as every query. No context → the DB fails closed (policies
 * compare against NULL → zero rows).
 *
 * ENTRY RULES (architect invariant):
 * - `enterTenantContext` / `enterRlsBypass` (enterWith-based) are for the
 *   per-request HTTP path ONLY — called inside requireAuth/getOrgId/
 *   requireSuperAdmin/requireCronAuth, they bind the remainder of the
 *   request's async continuation.
 * - Loops, setInterval ticks, scripts and any non-request code MUST use the
 *   .run()-based `runWithTenant` / `runWithRlsBypass` — enterWith inside a
 *   tick leaks into every subsequent tick (pinned by unit test).
 */
import { AsyncLocalStorage } from "node:async_hooks"

export interface RlsContext {
  orgId?: string
  bypass?: boolean
  /** set by the $transaction override so the per-op wrap passes through inside a tx */
  inTx?: boolean
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>()

export function getRlsContext(): RlsContext | undefined {
  return rlsStorage.getStore()
}

/** Scoped tenant context. Use for webhooks, public pages, per-tenant script sections. */
export function runWithTenant<T>(orgId: string, fn: () => T): T {
  if (!orgId || typeof orgId !== "string") {
    throw new Error("runWithTenant: orgId must be a non-empty string")
  }
  return rlsStorage.run({ orgId }, fn)
}

/** Scoped cross-tenant bypass. Use for auth bootstrap lookups, timer ticks, org-resolution in webhooks. */
export function runWithRlsBypass<T>(fn: () => T): T {
  return rlsStorage.run({ bypass: true }, fn)
}

/**
 * Bind tenant context to the remainder of the current request (HTTP guards only).
 * Returns false (and enters NOTHING) on empty orgId — '' would otherwise match
 * empty-string organizationId rows in the policy (Codex finding).
 */
export function enterTenantContext(orgId: string): boolean {
  if (!orgId || typeof orgId !== "string") {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[rls] enterTenantContext: empty orgId — context NOT entered (fail-closed)")
    }
    return false
  }
  rlsStorage.enterWith({ orgId })
  return true
}

/** Bind cross-tenant bypass to the remainder of the current request (HTTP guards only). */
export function enterRlsBypass(): void {
  rlsStorage.enterWith({ bypass: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib-rls-context.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/rls-context.ts src/__tests__/lib-rls-context.test.ts
git commit -m "feat(rls): AsyncLocalStorage tenant context — runWithTenant/runWithRlsBypass + enterWith guards, empty-orgId fail-closed, tick-leak invariant pinned"
```

---

### Task 2: Prisma 6.19.2 mechanics spike (GATE for the batch-$transaction strategy)

Self-contained script against a scratch Postgres; proves the four mechanics Codex could not confirm from docs. **Run it BEFORE Task 4 and record the verdict in the plan checkboxes below.**

**Files:**
- Create: `scripts/rls/spike-extension-mechanics.mjs`

- [x] **Step 1: Start scratch Postgres**

```bash
docker run -d --name rls-pg -e POSTGRES_PASSWORD=rls -p 55432:5432 postgres:16
sleep 3
```
(If docker is unavailable locally, run the spike on the server against a scratch DB: `createdb rls_spike` — NEVER against `leaddrive_v2`.)

- [x] **Step 2: Write the spike** *(committed spike is canonical — two adaptations vs the listing below, recorded under Step 4)*

```js
// scripts/rls/spike-extension-mechanics.mjs
// Proves Prisma 6.19.2 mechanics for the RLS extension design (plan Task 2 gate).
// Usage: RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres node scripts/rls/spike-extension-mechanics.mjs
import { PrismaClient } from "@prisma/client"
import { AsyncLocalStorage } from "node:async_hooks"

const url = process.env.RLS_TEST_DATABASE_URL
if (!url) { console.error("RLS_TEST_DATABASE_URL required"); process.exit(1) }

const als = new AsyncLocalStorage()
const hookLog = []

const base = new PrismaClient({ datasourceUrl: url })

async function main() {
  await base.$executeRawUnsafe(`DROP TABLE IF EXISTS spike_items`)
  await base.$executeRawUnsafe(`CREATE TABLE spike_items (id serial PRIMARY KEY, "organizationId" text NOT NULL, name text)`)
  await base.$executeRawUnsafe(`ALTER TABLE spike_items ENABLE ROW LEVEL SECURITY`)
  await base.$executeRawUnsafe(`ALTER TABLE spike_items FORCE ROW LEVEL SECURITY`)
  await base.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON spike_items`)
  await base.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON spike_items
    USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
    WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')`)

  const extended = base.$extends({
    query: {
      async $allOperations({ args, query, operation }) {
        const ctx = als.getStore()
        hookLog.push({ operation, ctx: ctx ? { ...ctx } : undefined })
        if (!ctx || ctx.inTx) return query(args)
        const setCfg = ctx.bypass
          ? base.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
          : base.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true)`
        const [, result] = await base.$transaction([setCfg, query(args)])
        return result
      },
    },
  })

  // Seed under bypass
  await als.run({ bypass: true }, async () => {
    await extended.$executeRaw`INSERT INTO spike_items ("organizationId", name) VALUES ('org-a','a1'),('org-b','b1')`
  })

  // CHECK 1 — per-op wrap on raw + model-less ops: tenant sees only own rows
  const c1 = await als.run({ orgId: "org-a" }, () => extended.$queryRaw`SELECT name FROM spike_items ORDER BY name`)
  console.log("CHECK1 per-op raw isolation:", JSON.stringify(c1), c1.length === 1 && c1[0].name === "a1" ? "PASS" : "FAIL")

  // CHECK 2 — no context → fail-closed (zero rows)
  const c2 = await extended.$queryRaw`SELECT name FROM spike_items`
  console.log("CHECK2 fail-closed:", JSON.stringify(c2), c2.length === 0 ? "PASS" : "FAIL")

  // CHECK 3 — interactive tx: set_config at open isolates inner queries; do hooks fire on tx?
  hookLog.length = 0
  const c3 = await als.run({ orgId: "org-a" }, () =>
    base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', 'org-a', true)`
      return als.run({ orgId: "org-a", inTx: true }, async () => {
        // NOTE: tx comes from base (no hooks); spike also checks extended-client interactive form below
        return tx.$queryRaw`SELECT name FROM spike_items`
      })
    })
  )
  console.log("CHECK3 interactive-tx isolation:", JSON.stringify(c3), c3.length === 1 ? "PASS" : "FAIL")

  // CHECK 4 — THE GATE: batch $transaction([...]) with prebuilt extended-client items.
  // Do per-item hooks run inside our als.run({inTx:true}) scope (ctx.inTx visible)?
  hookLog.length = 0
  const items = [
    extended.$queryRaw`SELECT name FROM spike_items WHERE "organizationId" = 'org-a'`,
    extended.$queryRaw`SELECT count(*)::int AS n FROM spike_items`,
  ]
  const setCfg = base.$executeRaw`SELECT set_config('app.org_id', 'org-a', true)`
  const c4 = await als.run({ orgId: "org-a", inTx: true }, () => base.$transaction([setCfg, ...items]))
  const itemHookCtxs = hookLog.filter((h) => h.operation === "$queryRaw").map((h) => h.ctx)
  const batchSawInTx = itemHookCtxs.length === 0 || itemHookCtxs.every((c) => c && c.inTx === true)
  console.log("CHECK4 batch ALS timing — item hook ctxs:", JSON.stringify(itemHookCtxs),
    "results:", JSON.stringify(c4.slice(1)), batchSawInTx ? "PASS" : "FAIL → fallback: convert batch callsites")

  // CHECK 5 — WITH CHECK blocks cross-tenant INSERT
  let c5 = "FAIL (insert was allowed)"
  try {
    await als.run({ orgId: "org-a" }, () => extended.$executeRaw`INSERT INTO spike_items ("organizationId", name) VALUES ('org-b','evil')`)
  } catch (e) {
    c5 = /row-level security|violates/.test(String(e.message)) ? "PASS" : `FAIL (${e.message})`
  }
  console.log("CHECK5 WITH CHECK blocks cross-org insert:", c5)

  await base.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [x] **Step 3: Run the spike**

Run: `RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres node scripts/rls/spike-extension-mechanics.mjs`
Expected: `CHECK1..CHECK5` all `PASS`.

- [x] **Step 4: Record the gate verdict (edit THIS plan file)**

- CHECK4 PASS → keep the batch override path in Task 4 exactly as written.
- CHECK4 FAIL → in Task 4, replace the array branch of `wrapTransaction` with `throw new Error("[rls] $transaction(array) with tenant context is unsupported — use interactive form")`, add a sub-task: convert the 14 `$transaction([` callsites in `src/` (9 prod files: contracts/{score-risk,redline,deviations/rescan,extract}, mtm/equipment/{[id],inspect,relocate,write-off}, mtm/repair-requests) to `$transaction(async (tx) => …)`, and add a classifier rule banning `$transaction([` under `src/app`.

> **GATE VERDICT (recorded 2026-06-10; Prisma 6.19.2, Node v20.20.2, postgres:16 scratch container `rls-pg`): CHECK4 PASS → keep the batch override path in Task 4 exactly as written.**
> Full results: CHECK1 PASS · CHECK2 PASS · CHECK3 PASS · CHECK4 PASS · CHECK5 PASS (stable across re-runs, idempotent).
> CHECK4 evidence: item hook ctxs `[{"orgId":"org-a","inTx":true},{"orgId":"org-a","inTx":true}]` — per-item extension hooks DO execute inside the caller's `als.run({inTx:true})` scope; in-batch isolation confirmed (`count(*)` returned n=1 after the in-batch `set_config`). The CHECK4-FAIL fallback (convert 14 batch callsites) is NOT needed.
>
> Two adaptations vs the Step 2 listing above (the committed `scripts/rls/spike-extension-mechanics.mjs` is canonical):
> 1. **Checks must run as a non-superuser role.** As written, the spike connected as `postgres` (superuser) and CHECK1/2/3/5 all failed OPEN — superusers always bypass RLS (addendum #3 residual). The spike now does DDL via the superuser client and runs every check through a `spike_app` LOGIN role (NOSUPERUSER NOBYPASSRLS, table+sequence grants only) — mirroring prod `hermes`. The runbook's Phase-0 NOSUPERUSER/NOBYPASSRLS preflight on `hermes` is hereby proven load-bearing, not theoretical.
> 2. **Lazy PrismaPromise: the await must happen INSIDE the ALS scope.** `als.run(ctx, () => extended.$queryRaw…)` (returning the promise, awaiting outside) executes the query pipeline at await-time with NO context → hook sees `undefined` → fail-closed `[]`. CHECK1/CHECK5 now use `als.run(ctx, async () => await …)`. Production impact: `enterWith` request paths and `runWithTenant(org, async () => { await … })` shapes are unaffected, but sweep patterns (Tasks 6–10) must never return a bare PrismaPromise out of `runWithTenant`/`runWithRlsBypass` without awaiting inside (failure direction is fail-closed = safe, but yields empty reads / blocked writes), and Task 5's integration tests must use await-inside shapes.
> **Hardening (architect fix-before-build, landed before Task 3):** `runWithTenant`/`runWithRlsBypass` force-await internally (`rlsStorage.run(ctx, async () => await fn())`) as of this commit — one-liner callbacks in the Tasks 5/10 snippets are safe as written; spike Postgres server version: PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1) on aarch64-unknown-linux-gnu.

- [x] **Step 5: Commit**

```bash
git add scripts/rls/spike-extension-mechanics.mjs docs/superpowers/plans/2026-06-10-postgres-rls-tenant-isolation.md
git commit -m "feat(rls): mechanics spike — per-op wrap, fail-closed, interactive/batch tx, WITH CHECK (Task 2 gate verdict recorded)"
```

---

### Task 3: Policy generator (`scripts/rls/generate-rls-policies.mjs`)

**Files:**
- Create: `scripts/rls/generate-rls-policies.mjs`
- Test: `src/__tests__/rls-policy-generator.test.ts`

- [ ] **Step 1: Write the failing tests (pure emit functions)**

```ts
// src/__tests__/rls-policy-generator.test.ts
import { describe, it, expect } from "vitest"
// vitest resolves .mjs fine; the generator exports pure functions for testing
import { emitEnableSql, emitDisableSql, planBatches, AUTH_CRITICAL_TABLES, BATCH1_CANDIDATES } from "../../scripts/rls/generate-rls-policies.mjs"

describe("rls policy generator", () => {
  it("emitEnableSql emits ENABLE + FORCE + policy with USING and WITH CHECK", () => {
    const sql = emitEnableSql(["deals"])
    expect(sql).toContain(`ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "deals";`)
    expect(sql).toMatch(/USING \(\s*"organizationId" = current_setting\('app\.org_id', true\)\s*OR current_setting\('app\.rls_bypass', true\) = 'on'\s*\)/)
    expect(sql).toMatch(/WITH CHECK \(\s*"organizationId" = current_setting\('app\.org_id', true\)\s*OR current_setting\('app\.rls_bypass', true\) = 'on'\s*\)/)
  })

  it("emitDisableSql emits instant rollback (DISABLE + DROP POLICY)", () => {
    const sql = emitDisableSql(["deals"])
    expect(sql).toContain(`ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "deals";`)
  })

  it("planBatches: batch 1 = pinned low-risk intersection; auth-critical tables land ONLY in the final batch", () => {
    const tables = ["currencies", "task_types", "event_types", "sla_policies", "deals", "leads", "users", "api_keys", "contacts"]
    const batches = planBatches(tables, 3)
    expect(batches[0]).toEqual(["currencies", "event_types", "sla_policies", "task_types"]) // sorted intersection with BATCH1_CANDIDATES
    const last = batches[batches.length - 1]
    for (const t of AUTH_CRITICAL_TABLES) expect(last).toContain(t)
    for (const b of batches.slice(0, -1)) {
      expect(b).not.toContain("users")
      expect(b).not.toContain("api_keys")
    }
    expect(batches.flat().sort()).toEqual([...tables].sort()) // total, no drops
  })

  it("planBatches throws when fewer than 3 batch-1 candidates exist (name drift guard)", () => {
    expect(() => planBatches(["deals", "users"], 2)).toThrow(/batch-1/)
  })

  it("BATCH1_CANDIDATES contains only low-risk lookup tables", () => {
    expect(BATCH1_CANDIDATES).toHaveLength(5)
    expect(BATCH1_CANDIDATES).not.toContain("users")
    expect(BATCH1_CANDIDATES).not.toContain("deals")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/rls-policy-generator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the generator**

```js
// scripts/rls/generate-rls-policies.mjs
// Generates idempotent per-batch enable/disable SQL for tenant RLS policies.
// Tables = every public table with an "organizationId" column, minus exclusions.
// Usage:
//   node scripts/rls/generate-rls-policies.mjs            # writes scripts/rls/enable-batch-N.sql + disable-batch-N.sql
//   node scripts/rls/generate-rls-policies.mjs --dry-run  # prints table count + batch composition only
import { PrismaClient } from "@prisma/client"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EXCLUDED_TABLES = ["_prisma_migrations"]
/** Queried by auth bootstrap (login, api-key, jwt refresh) — enabled LAST (final batch). */
export const AUTH_CRITICAL_TABLES = ["users", "api_keys"]
/** Low-risk lookup tables for the first enable batch (intersected with live schema; ≥3 must match). All 5 verified to exist with organizationId. */
export const BATCH1_CANDIDATES = ["currencies", "task_types", "event_types", "sla_policies", "task_templates"]

const POLICY = (table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "${table}";
CREATE POLICY tenant_isolation ON "${table}"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );`

export function emitEnableSql(tables) {
  return [
    `-- Generated by scripts/rls/generate-rls-policies.mjs — idempotent, instantly reversible via the matching disable file.`,
    ...tables.map(POLICY),
  ].join("\n\n") + "\n"
}

export function emitDisableSql(tables) {
  return [
    `-- Instant rollback: RLS off for this batch. No data movement.`,
    ...tables.map(
      (t) => `DROP POLICY IF EXISTS tenant_isolation ON "${t}";
ALTER TABLE "${t}" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "${t}" DISABLE ROW LEVEL SECURITY;`
    ),
  ].join("\n\n") + "\n"
}

/**
 * batch 1 = sorted(BATCH1_CANDIDATES ∩ tables); final batch = AUTH_CRITICAL_TABLES (present in schema);
 * middle = the rest chunked into `middleBatches` alphabetical chunks. Total partition, no drops.
 */
export function planBatches(tables, middleBatches = 3) {
  const set = new Set(tables)
  const batch1 = BATCH1_CANDIDATES.filter((t) => set.has(t)).sort()
  if (batch1.length < 3) throw new Error(`batch-1 candidates matched <3 live tables (${batch1.join(", ")}) — check BATCH1_CANDIDATES against the real schema`)
  const final = AUTH_CRITICAL_TABLES.filter((t) => set.has(t)).sort()
  const middle = tables.filter((t) => !batch1.includes(t) && !final.includes(t)).sort()
  const size = Math.ceil(middle.length / middleBatches) || 1
  const chunks = []
  for (let i = 0; i < middle.length; i += size) chunks.push(middle.slice(i, i + size))
  return [batch1, ...chunks, final].filter((b) => b.length > 0)
}

async function introspectTenantTables(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organizationId'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDED_TABLES.includes(t))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const prisma = new PrismaClient()
  const tables = await introspectTenantTables(prisma)
  const batches = planBatches(tables)
  console.log(`tenant tables: ${tables.length}; batches: ${batches.map((b) => b.length).join(" + ")}`)
  if (process.argv.includes("--dry-run")) {
    batches.forEach((b, i) => console.log(`batch ${i + 1}:`, b.join(", ")))
  } else {
    const outDir = dirname(fileURLToPath(import.meta.url))
    batches.forEach((b, i) => {
      writeFileSync(join(outDir, `enable-batch-${i + 1}.sql`), emitEnableSql(b))
      writeFileSync(join(outDir, `disable-batch-${i + 1}.sql`), emitDisableSql(b))
    })
    console.log(`wrote ${batches.length} × enable/disable SQL files to scripts/rls/`)
  }
  await prisma.$disconnect()
}
```

- [ ] **Step 4: Run tests + a dry-run against the local dev DB (if reachable)**

Run: `npx vitest run src/__tests__/rls-policy-generator.test.ts`
Expected: PASS (5 tests)
Run (optional, needs dev DATABASE_URL): `node scripts/rls/generate-rls-policies.mjs --dry-run`
Expected: `tenant tables: ~300; batches: …` — if batch-1 throws on <3 matches, fix `BATCH1_CANDIDATES` to real table names from the dry-run listing and update the test.

- [ ] **Step 5: Commit**

```bash
git add scripts/rls/generate-rls-policies.mjs src/__tests__/rls-policy-generator.test.ts
git commit -m "feat(rls): policy generator — USING+WITH CHECK per table, batch planner (low-risk first, auth-critical last), instant-rollback SQL"
```

---

### Task 4: RLS Prisma extension + `$transaction` override (`src/lib/prisma.ts`)

**Files:**
- Modify: `src/lib/prisma.ts` (after the soft-delete extension, before exports)
- Test: `src/__tests__/lib-prisma-rls-extension.test.ts`

- [ ] **Step 1: Write the failing tests (stub client, no DB)**

```ts
// src/__tests__/lib-prisma-rls-extension.test.ts
import { describe, it, expect, vi } from "vitest"
import { rlsStorage, runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { __rlsPerOpWrap, __wrapTransaction } from "@/lib/prisma"

function makeStubBase() {
  const calls: any[] = []
  const stub = {
    calls,
    $executeRaw: vi.fn((..._a: any[]) => ({ __setCfg: true })),
    $transaction: vi.fn(async (arg: any, opts?: any) => {
      calls.push({ arg, opts })
      if (typeof arg === "function") {
        const tx = { $executeRaw: vi.fn(async () => 1), label: "tx" }
        return arg(tx)
      }
      return Promise.all(arg.map((p: any) => (typeof p?.then === "function" ? p : Promise.resolve(p))))
    }),
  }
  return stub
}

describe("rls per-operation wrap", () => {
  it("no context → passes through untouched (and the DB fails closed)", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async (a: any) => ({ rows: a }))
    const result = await wrap({ args: { where: 1 }, query, operation: "findMany", model: "Deal" } as any)
    expect(result).toEqual({ rows: { where: 1 } })
    expect(base.$transaction).not.toHaveBeenCalled()
  })

  it("tenant context → wraps op in a batch tx with set_config first", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async () => "data")
    const result = await runWithTenant("org-a", () =>
      wrap({ args: {}, query, operation: "findMany", model: "Deal" } as any)
    )
    expect(result).toBe("data")
    expect(base.$transaction).toHaveBeenCalledTimes(1)
    const batch = base.$transaction.mock.calls[0][0]
    expect(Array.isArray(batch)).toBe(true)
    expect(batch).toHaveLength(2)
    expect(base.$executeRaw).toHaveBeenCalledTimes(1) // the set_config statement
  })

  it("bypass context → set_config app.rls_bypass", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    await runWithRlsBypass(() => wrap({ args: {}, query: vi.fn(async () => 1), operation: "count", model: "Deal" } as any))
    const tpl = base.$executeRaw.mock.calls[0][0]
    expect(String(tpl.join?.("") ?? tpl)).toContain("app.rls_bypass")
  })

  it("inTx context → passes through (no nested transaction)", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async () => "inner")
    const result = await rlsStorage.run({ orgId: "org-a", inTx: true }, () =>
      wrap({ args: {}, query, operation: "findMany", model: "Deal" } as any)
    )
    expect(result).toBe("inner")
    expect(base.$transaction).not.toHaveBeenCalled()
  })
})

describe("rls $transaction override", () => {
  it("no context → delegates verbatim (arg + opts)", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    const fn = async () => "x"
    await $transaction(fn, { timeout: 5000 })
    expect(base.$transaction).toHaveBeenCalledWith(fn, { timeout: 5000 })
  })

  it("interactive form: injects set_config first, runs callback under inTx, preserves opts", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    let seenCtx: any
    const result = await runWithTenant("org-a", () =>
      $transaction(async (tx: any) => {
        seenCtx = rlsStorage.getStore()
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1) // set_config ran on the tx FIRST
        return "done"
      }, { isolationLevel: "Serializable" })
    )
    expect(result).toBe("done")
    expect(seenCtx).toEqual({ orgId: "org-a", inTx: true })
    expect(base.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" })
  })

  it("batch form: prepends set_config, slices it off the results", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    const result = await runWithTenant("org-a", () => $transaction([Promise.resolve("r1"), Promise.resolve("r2")]))
    expect(result).toEqual(["r1", "r2"]) // set_config result hidden from caller
    const batch = base.$transaction.mock.calls[0][0]
    expect(batch).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib-prisma-rls-extension.test.ts`
Expected: FAIL — `__rlsPerOpWrap` / `__wrapTransaction` not exported

- [ ] **Step 3: Implement in `src/lib/prisma.ts`**

Insert after the existing `prismaExtended` definition (line ~66) and REPLACE the current `export const prisma = prismaExtended` and `tenantPrisma`'s base:

```ts
import { getRlsContext, rlsStorage, type RlsContext } from "./rls-context"

/* ------------------------------------------------------------------ */
/* Postgres RLS context injection                                      */
/* ------------------------------------------------------------------ */

/** Builds the transaction-local set_config statement on the given client (basePrisma or an interactive tx). */
function setCfgOn(client: any, ctx: RlsContext) {
  return ctx.bypass
    ? client.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
    : client.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true)`
}

/**
 * Per-operation wrap (exported for unit tests). With tenant/bypass context the
 * operation is batched into a transaction with set_config so both share one
 * connection (documented Prisma RLS pattern). No context → pass through (the
 * DB fails closed once RLS is enabled). inTx → set_config already ran at tx
 * open. setCfg is built on basePrisma so this hook can't recurse on $executeRaw.
 */
export function __rlsPerOpWrap(txOpener: any) {
  return async function rlsAllOperations({ args, query, operation, model }: any) {
    const ctx = getRlsContext()
    if (!ctx || ctx.inTx) {
      if (!ctx && model && process.env.NODE_ENV !== "production") {
        console.warn(`[rls] ${model}.${operation} with NO tenant context — will return 0 rows once RLS is enabled on its table`)
      }
      return query(args)
    }
    const [, result] = await txOpener.$transaction([setCfgOn(txOpener, ctx), query(args)])
    return result
  }
}

const rlsExtended = prismaExtended.$extends({
  query: {
    // top-level $allOperations: covers ALL model ops AND $queryRaw/$executeRaw/$queryRawUnsafe/$executeRawUnsafe
    $allOperations: __rlsPerOpWrap(basePrisma),
  },
})

/**
 * $transaction override (exported for unit tests). $extends cannot shadow
 * built-ins, so the exported client is a Proxy that swaps $transaction:
 * - interactive form: set_config runs as the FIRST statement on the tx
 *   connection, callback executes under {inTx:true} so per-op hooks pass
 *   through (note: Prisma query extensions do not apply to the tx client —
 *   isolation comes from the tx-open set_config either way);
 * - batch form: set_config is prepended on the same batch tx and sliced off
 *   the results. Per-item hooks execute inside the run({inTx:true}) scope
 *   (verified by scripts/rls/spike-extension-mechanics.mjs CHECK4).
 */
export function __wrapTransaction(base: any, setCfgClient: any) {
  return function $transaction(arg: any, opts?: any) {
    const ctx = getRlsContext()
    if (!ctx || ctx.inTx) return base.$transaction(arg, opts)
    if (typeof arg === "function") {
      return base.$transaction(async (tx: any) => {
        await setCfgOn(tx, ctx)
        return rlsStorage.run({ ...ctx, inTx: true }, () => arg(tx))
      }, opts)
    }
    return rlsStorage
      .run({ ...ctx, inTx: true }, () => base.$transaction([setCfgOn(setCfgClient, ctx), ...arg], opts))
      .then((results: any[]) => results.slice(1))
  }
}

/** Wrap a client in the $transaction-override Proxy; re-wraps $extends children so tenantPrisma stays covered. */
function withRlsTxOverride<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target: any, prop) {
      if (prop === "$transaction") return __wrapTransaction(target, basePrisma)
      if (prop === "$extends") {
        const orig = target[prop]
        return (...a: any[]) => withRlsTxOverride(orig.apply(target, a))
      }
      const v = target[prop]
      return typeof v === "function" ? v.bind(target) : v
    },
  })
}

export const prisma = withRlsTxOverride(rlsExtended)
```

And change `tenantPrisma` to chain from the RLS-extended client (so tenant-scoped clients also inject set_config) — replace its first line:

```ts
export function tenantPrisma(organizationId: string) {
  // Chain from the RLS-extended client (which chains from soft-delete) so
  // tenant-scoped reads exclude deletedAt AND carry RLS set_config; the
  // Proxy re-wrap keeps the $transaction override on the derived client.
  return prisma.$extends({
```

(body of the `$extends({...})` stays exactly as today).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/lib-prisma-rls-extension.test.ts src/__tests__/lib-prisma-soft-delete.test.ts`
Expected: PASS — new tests green AND the existing soft-delete suite untouched-green (proves chaining order didn't break it).
Run: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Re-run the Task 2 spike pattern against THIS module (sanity, optional but recommended)**

If the scratch PG is still up: temporarily point `DATABASE_URL` at it in a one-off node REPL and exercise `prisma.$queryRaw` under `runWithTenant` — same expectations as CHECK1/2. (The full integration suite lands in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/prisma.ts src/__tests__/lib-prisma-rls-extension.test.ts
git commit -m "feat(rls): prisma extension — \$allOperations set_config wrap + \$transaction override Proxy (interactive+batch), tenantPrisma rebased, fail-closed dev warning"
```

---

### Task 5: Integration suite on real Postgres (env-gated)

**Files:**
- Test: `src/__tests__/rls-integration.test.ts`

- [ ] **Step 1: Write the suite**

```ts
// src/__tests__/rls-integration.test.ts
// Real-Postgres isolation matrix. Skips entirely unless RLS_TEST_DATABASE_URL is set.
// Local rig: docker run -d --name rls-pg -e POSTGRES_PASSWORD=rls -p 55432:5432 postgres:16
//            RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres npx vitest run src/__tests__/rls-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { emitEnableSql, emitDisableSql } from "../../scripts/rls/generate-rls-policies.mjs"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

const url = process.env.RLS_TEST_DATABASE_URL

describe.skipIf(!url)("RLS integration (real Postgres)", () => {
  let prisma: any // the real exported client from src/lib/prisma — constructed against the scratch DB
  let base: any

  beforeAll(async () => {
    // Run this file STANDALONE (see header command): the singleton must bind to
    // the scratch DB, so clear any cached module/global client first.
    process.env.DATABASE_URL = url // must be set BEFORE importing src/lib/prisma
    const { vi } = await import("vitest")
    vi.resetModules()
    delete (globalThis as { prisma?: unknown }).prisma // src/lib/prisma caches on globalThis in non-prod
    const mod = await import("@/lib/prisma")
    prisma = mod.prisma
    const { PrismaClient } = await import("@prisma/client")
    base = new PrismaClient({ datasourceUrl: url })
    await base.$executeRawUnsafe(`DROP TABLE IF EXISTS rls_deals`)
    await base.$executeRawUnsafe(`DROP TABLE IF EXISTS rls_globals`)
    await base.$executeRawUnsafe(`CREATE TABLE rls_deals (id serial PRIMARY KEY, "organizationId" text NOT NULL, title text)`)
    await base.$executeRawUnsafe(`CREATE TABLE rls_globals (id serial PRIMARY KEY, name text)`) // no organizationId — generator must skip it
    for (const stmt of emitEnableSql(["rls_deals"]).split(";\n").map((s) => s.trim()).filter(Boolean)) {
      await base.$executeRawUnsafe(stmt)
    }
    await base.$executeRawUnsafe(`INSERT INTO rls_deals ("organizationId", title) VALUES ('org-a','A1'),('org-a','A2'),('org-b','B1')`)
  })

  afterAll(async () => {
    for (const stmt of emitDisableSql(["rls_deals"]).split(";\n").map((s) => s.trim()).filter(Boolean)) {
      await base.$executeRawUnsafe(stmt).catch(() => {})
    }
    await base.$disconnect()
  })

  it("tenant A cannot read tenant B — even via a deliberately unscoped raw query", async () => {
    const rows = await runWithTenant("org-a", () => prisma.$queryRaw`SELECT title FROM rls_deals ORDER BY title`)
    expect(rows.map((r: any) => r.title)).toEqual(["A1", "A2"])
  })

  it("no context → fail-closed (zero rows, no error)", async () => {
    const rows = await prisma.$queryRaw`SELECT title FROM rls_deals`
    expect(rows).toEqual([])
  })

  it("bypass sees all rows", async () => {
    const rows = await runWithRlsBypass(() => prisma.$queryRaw`SELECT count(*)::int AS n FROM rls_deals`)
    expect(rows[0].n).toBe(3)
  })

  it("WITH CHECK blocks a cross-tenant INSERT", async () => {
    await expect(
      runWithTenant("org-a", () => prisma.$executeRaw`INSERT INTO rls_deals ("organizationId", title) VALUES ('org-b','EVIL')`)
    ).rejects.toThrow(/row-level security/)
  })

  it("WITH CHECK allows same-tenant INSERT", async () => {
    const n = await runWithTenant("org-a", () => prisma.$executeRaw`INSERT INTO rls_deals ("organizationId", title) VALUES ('org-a','A3')`)
    expect(n).toBe(1)
  })

  it("interactive $transaction: inner raw queries are tenant-scoped via tx-open set_config", async () => {
    const titles = await runWithTenant("org-b", () =>
      prisma.$transaction(async (tx: any) => {
        const rows = await tx.$queryRaw`SELECT title FROM rls_deals ORDER BY title`
        return rows.map((r: any) => r.title)
      })
    )
    expect(titles).toEqual(["B1"])
  })

  it("batch $transaction: items are tenant-scoped, set_config result is sliced off", async () => {
    const [a, count] = await runWithTenant("org-a", () =>
      prisma.$transaction([
        prisma.$queryRaw`SELECT title FROM rls_deals WHERE title = 'A1'`,
        prisma.$queryRaw`SELECT count(*)::int AS n FROM rls_deals`,
      ])
    )
    expect(a[0].title).toBe("A1")
    expect(count[0].n).toBe(3) // org-a rows only (A1, A2, A3 from earlier insert)
  })

  it("owner WITHOUT FORCE would leak — regression-proves why FORCE is in the policy", async () => {
    await base.$executeRawUnsafe(`ALTER TABLE rls_deals NO FORCE ROW LEVEL SECURITY`)
    // base connects as the table owner; with RLS enabled but not forced, owner bypasses policies
    const rows = await base.$queryRawUnsafe(`SELECT count(*)::int AS n FROM rls_deals`)
    expect(Number(rows[0].n)).toBeGreaterThan(0)
    await base.$executeRawUnsafe(`ALTER TABLE rls_deals FORCE ROW LEVEL SECURITY`)
  })

  it("login-bootstrap shape: bypass lookup then runWithTenant works end-to-end", async () => {
    const resolved = await runWithRlsBypass(() => prisma.$queryRaw`SELECT "organizationId" FROM rls_deals WHERE title = 'B1'`)
    const orgId = resolved[0].organizationId
    const rows = await runWithTenant(orgId, () => prisma.$queryRaw`SELECT title FROM rls_deals`)
    expect(rows.map((r: any) => r.title)).toEqual(["B1"])
  })
})
```

- [ ] **Step 2: Run WITHOUT the env var (CI shape)**

Run: `npx vitest run src/__tests__/rls-integration.test.ts`
Expected: suite reported as skipped, exit 0.

- [ ] **Step 3: Run WITH the scratch DB**

Run: `RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres npx vitest run src/__tests__/rls-integration.test.ts`
Expected: PASS (9 tests). If the batch test fails here but Task 2 CHECK4 passed, re-check the Proxy slice logic before anything else.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/rls-integration.test.ts
git commit -m "test(rls): real-PG isolation matrix — cross-tenant read/write, fail-closed, bypass, interactive+batch tx, FORCE regression, bootstrap shape"
```

---

### Task 6: Guard entry — auth bootstrap bypass + tenant context entry

**Files:**
- Modify: `src/lib/api-auth.ts` (4 bootstrap lookups + entry points in `requireAuth`/`getOrgId`)
- Modify: `src/lib/superadmin-guard.ts:22`
- Modify: `src/lib/auth.ts` (adapter wrap at :17; authorize :52/:66; signIn :179–:196; jwt :209/:264)
- Modify: `src/lib/mobile-auth.ts` (2 lookups in `resolveMobileAuth`)
- Test: extend `src/__tests__/lib-rls-context.test.ts` patterns where unit-testable; main proof = integration + E2E

- [ ] **Step 1: `src/lib/api-auth.ts` — wrap bootstrap lookups**

Add import at top: `import { runWithRlsBypass, enterTenantContext, getRlsContext } from "./rls-context"`.

Wrap each of these prisma calls in `runWithRlsBypass(() => …)` (they all execute BEFORE tenant context exists; `users`/`api_keys` get policies):

1. `getOrgSlug` (line ~107): `const org = await runWithRlsBypass(() => prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } }))` — organizations is a global table today, wrapped anyway for future-proofing.
2. `getApiKeyAuth` (line ~179): `const apiKey = await runWithRlsBypass(() => prisma.apiKey.findFirst({ where: { keyHash, isActive: true }, include: { organization: true } }))`
3. `getApiKeyAuth` lastUsedAt update (line ~187): `runWithRlsBypass(() => prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })).catch(() => {})`
4. password-changed check in `requireAuth` (line ~336): `const dbUser = await runWithRlsBypass(() => prisma.user.findUnique({ where: { id: session.userId }, select: { passwordChangedAt: true } }))`
5. org-status check in `requireAuth` (line ~365, `prisma.organization.findUnique`): wrap the same way.

- [ ] **Step 2: `src/lib/api-auth.ts` — enter tenant context at every success return**

In `getOrgId` (3 success paths):
```ts
// line ~213
if (session?.orgId) { enterTenantContext(session.orgId); return session.orgId }
// line ~223
if (mobileAuth?.orgId) { enterTenantContext(mobileAuth.orgId); return mobileAuth.orgId }
// line ~247 (final return)
enterTenantContext(apiKeyAuth.orgId)
return apiKeyAuth.orgId
```

In `requireAuth` (2 success paths):
```ts
// API-key path (line ~301), after tenantBindingOk:
enterTenantContext(apiKeyAuth.orgId)
return apiKeyAuth
// session path — immediately before `return session` (~line 420, the SINGLE final
// AuthResult return; it sits AFTER the deactivation/permission/module 403 gates —
// do NOT enter context earlier than this line):
enterTenantContext(session.orgId)
return session
```
Verify you caught every success return: `grep -n "return apiKeyAuth\|return session\|return {" src/lib/api-auth.ts` — every AuthResult-returning line in those two functions must be preceded by `enterTenantContext`. Superadmin sessions also enter their own org here; `requireSuperAdmin` upgrades to bypass next.

- [ ] **Step 3: `src/lib/superadmin-guard.ts` — bypass after role check**

```ts
import { enterRlsBypass } from "./rls-context"
// inside requireSuperAdmin, after the role check passes (line ~30):
  enterRlsBypass() // superadmin operates cross-tenant; replaces the tenant ctx entered by requireAuth
  return result
```

- [ ] **Step 4: `src/lib/auth.ts` — adapter + callbacks**

Add import: `import { runWithRlsBypass } from "./rls-context"`.

(a) Wrap the adapter (line ~17) — NextAuth's PrismaAdapter queries users/accounts during OAuth flows with no context:
```ts
function bypassAdapter<A extends object>(adapter: A): A {
  const wrapped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(adapter)) {
    wrapped[k] = typeof v === "function" ? (...args: unknown[]) => runWithRlsBypass(() => (v as (...a: unknown[]) => unknown)(...args)) : v
  }
  return wrapped as A
}
// …
  adapter: bypassAdapter(PrismaAdapter(prisma)),
```

(b) `authorize` (lines ~52 and ~66): wrap the two calls:
```ts
const candidates = await runWithRlsBypass(() => prisma.user.findMany({ where, include: { organization: true } }))
// …
await runWithRlsBypass(() => prisma.user.update({
  where: { id: user.id },
  data: { lastLogin: new Date(), loginCount: { increment: 1 } },
})).catch(() => {})
```

(c) `signIn` callback OAuth branch (lines ~179–196): wrap the whole branch body in one scope:
```ts
if (account?.provider === "google" || account?.provider === "microsoft-entra-id") {
  return runWithRlsBypass(async () => {
    // …existing findFirst + organization.create + user.create body unchanged…
    return true
  })
}
```

(d) `jwt` callback (lines ~209 and ~264): wrap both `prisma.user.findUnique` calls in `runWithRlsBypass(() => …)` the same way. This callback runs on EVERY request's session resolution — without the wrap, every authed request fails closed once `users` is enabled.

- [ ] **Step 5: `src/lib/mobile-auth.ts` — wrap the 2 lookups in `resolveMobileAuth`**

Add `import { runWithRlsBypass } from "./rls-context"` and wrap both revocation-check lookups (they run before any tenant context exists):

```ts
// line ~70 — agent + org revocation check:
const agent = await runWithRlsBypass(() => prisma.mtmAgent.findFirst({
  where: { id: decoded.agentId, organizationId: decoded.orgId },
  select: { status: true, organization: { select: { isActive: true } } },
}))
// line ~93 — linked-user revocation check (FIX C):
const user = await runWithRlsBypass(() => prisma.user.findFirst({
  where: { id: decoded.userId, organizationId: decoded.orgId },
  select: { isActive: true },
}))
```
The surrounding status checks, warnings and the fail-closed catch stay byte-identical.

- [ ] **Step 6: Typecheck + targeted tests + full suite**

Run: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`
Expected: 0 errors.
Run: `npx vitest run src/__tests__/lib-auth src/__tests__/lib-rls-context.test.ts` (existing lib-auth* suites must stay green — they pin authorize/jwt behavior)
Run: `npm test` (full)
Expected: failures ≤ baseline 5, all pre-existing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api-auth.ts src/lib/superadmin-guard.ts src/lib/auth.ts src/lib/mobile-auth.ts
git commit -m "feat(rls): guard entry — bypass-wrapped auth bootstrap (adapter, authorize, signIn, jwt, api-key, mobile, pw/org checks) + enterTenantContext at every guard success path"
```

---

### Task 7: Cron choke point (`requireCronAuth`) + sweep

**Files:**
- Create: `src/lib/cron-auth.ts`
- Test: `src/__tests__/lib-cron-auth.test.ts`
- Modify: every `src/app/api/cron/*/route.ts` (34 dirs) + `src/app/api/v1/social/cron/poll-all/route.ts` + `src/app/api/v1/journeys/process/route.ts`

**NOT in this sweep:** `src/app/api/v1/webhooks/meeting-recap/route.ts` — it is a WEBHOOK with its own secret (`x-meeting-webhook-secret` against `MEETING_WEBHOOK_SECRET || CRON_SECRET` fallback, route lines ~37–41); forcing it onto `requireCronAuth` would break the existing integrator. It is handled in Task 10 and allowlisted in the Task 11 classifier.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib-cron-auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/test", { headers })
}

describe("requireCronAuth", () => {
  const OLD = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret"
    rlsStorage.enterWith(undefined as never) // reset leaked context between tests
  })
  afterEach(() => { process.env.CRON_SECRET = OLD })

  it("503 when CRON_SECRET unset (closed-by-default)", async () => {
    delete process.env.CRON_SECRET
    const res = requireCronAuth(req({ "x-cron-secret": "anything" }))
    expect(res?.status).toBe(503)
  })

  it("401 on missing or wrong secret", () => {
    expect(requireCronAuth(req())?.status).toBe(401)
    expect(requireCronAuth(req({ "x-cron-secret": "wrong" }))?.status).toBe(401)
  })

  it("accepts x-cron-secret header and enters bypass context", () => {
    const res = requireCronAuth(req({ "x-cron-secret": "s3cret" }))
    expect(res).toBeNull()
    expect(getRlsContext()).toEqual({ bypass: true })
  })

  it("accepts Authorization: Bearer form", () => {
    expect(requireCronAuth(req({ authorization: "Bearer s3cret" }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/lib-cron-auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the guard**

```ts
// src/lib/cron-auth.ts
import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { enterRlsBypass } from "./rls-context"

/** Constant-time string compare — journeys/process already used timingSafeEqual; the choke point must not downgrade it. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Shared guard for cron-shaped routes (the RLS bypass choke point — the CI
 * classifier in src/__tests__/rls-bypass-classifier.test.ts is written
 * against THIS function; do not re-inline secret checks in routes).
 *
 * Returns null on success (and binds RLS bypass to the request) or a
 * NextResponse error: 503 when CRON_SECRET is unset, 401 on mismatch.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "")
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  enterRlsBypass()
  return null
}
```

- [ ] **Step 4: Run the test — PASS, then sweep all 36 routes**

For EACH route in `src/app/api/cron/*/route.ts` (34) plus the 2 cron-shaped routes (`social/cron/poll-all`, `journeys/process`): delete the inline secret check block and replace with:

```ts
import { requireCronAuth } from "@/lib/cron-auth"
// first lines of the handler:
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
```

Behavior normalization (declared): all 36 now return 503 (unset) / 401 (mismatch) with both header forms accepted and constant-time compare — 24 routes already returned exactly these statuses; the rest converge. Two specifics for `journeys/process`:
- its `500 "Server misconfigured"` on unset secret becomes `503` (normalization, declared);
- the stale `// Authenticate: require CRON_SECRET or valid session` comment is REMOVED with the block — no session path ever existed in the code (verified route lines 20–31), so nothing is dropped;
- delete the now-unused local `safeCompare` helper and `timingSafeEqual` import in that route.

Find leftovers: `grep -rln "CRON_SECRET" src/app/api | grep -v cron-auth` → must list ONLY `webhooks/meeting-recap/route.ts` (its env fallback — classified in Tasks 10/11) when done.

- [ ] **Step 5: Typecheck + commit**

Run: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → 0 errors.
Run: `npx vitest run src/__tests__/lib-cron-auth.test.ts` → PASS.

```bash
git add src/lib/cron-auth.ts src/__tests__/lib-cron-auth.test.ts src/app/api
git commit -m "feat(rls): requireCronAuth choke point (timingSafeEqual) + sweep 34 /api/cron routes + poll-all + journeys/process (503/401 normalized, bypass entry)"
```

---

### Task 8: Instrumentation timers → shared client + `.run()` bypass

**Files:**
- Modify: `src/instrumentation.ts` (finance tick :54–147, MTM tick :163–235; journey :27 and social :261 timers are fetch-only — leave them)

- [ ] **Step 1: Refactor the finance tick**

Replace the per-tick client (lines 56–57: `const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient()`) and the tick body with the shared client + scoped bypass; drop the `await prisma.$disconnect()` (line 134):

```ts
const runFinanceCheck = async () => {
  try {
    const { prisma } = await import("./lib/prisma")
    const { runWithRlsBypass } = await import("./lib/rls-context")
    await runWithRlsBypass(async () => {
      const now = new Date()
      const orgs = await prisma.organization.findMany({ select: { id: true } })
      // …ENTIRE existing per-org body unchanged (bills/invoices/contracts updateMany + Telegram notifications)…
    })
    // …existing console.log summary lines stay (move them inside the bypass scope together with the counters)…
  } catch (err: any) {
    console.error("[Finance Cron] Error:", err.message)
  }
}
```

INVARIANT: this is a `setInterval` tick — `.run()`-based `runWithRlsBypass` ONLY; `enterRlsBypass()` here would leak bypass into unrelated async work forever (pinned by the Task 1 leak test).

- [ ] **Step 2: Refactor the MTM auto-checkout tick (lines 163–235) identically**

Same transformation: shared `prisma` + `runWithRlsBypass` around the whole tick body, remove `new PrismaClient()` and `$disconnect`.

- [ ] **Step 3: Verify**

Run: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → 0 errors.
Run: `grep -n "new PrismaClient" src/instrumentation.ts` → no matches.
Run: `npm run dev` briefly (or `next build` smoke) → server boots, `[Finance Cron] Starting deadline checker` logs appear, no module-resolution errors.

- [ ] **Step 4: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat(rls): instrumentation timers — shared prisma client + runWithRlsBypass per tick (.run isolation), per-tick clients removed"
```

---

### Task 9: Scripts helper (`scripts/_rls.mjs`) + 46-script sweep

**Files:**
- Create: `scripts/_rls.mjs`
- Modify: 46 scripts with `new PrismaClient` (list via `grep -rln "new PrismaClient" scripts/ --include="*.mjs" --include="*.ts" --include="*.js"`)
- Modify: scripts importing `src/lib/prisma` (8 files: `backfill-plan-features.mjs`, `populate-plan.ts`, `fix-revenue-plan.ts`, `backfill-payment-registry.ts`, `fix-plan-to-quarterly.ts`, `import-expense-actuals.ts`, `seeds/afigroup.mjs`, `backfill-renewal-alerts.ts` — re-grep to confirm)

- [ ] **Step 1: Implement the helper**

```js
// scripts/_rls.mjs
// RLS-aware Prisma factory for standalone scripts (own client, NOT src/lib/prisma).
// Pool SET state is per-connection → pin connection_limit=1 and set the bypass
// (or tenant) setting session-wide (is_local=false) once after connect.
// Classification: operator-run scripts are cross-tenant by default → bypass.
// Per-tenant seeds may pass { orgId } to scope writes instead.
import { PrismaClient } from "@prisma/client"

export async function makeScriptPrisma({ orgId } = {}) {
  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.set("connection_limit", "1")
  const prisma = new PrismaClient({ datasourceUrl: url.toString() })
  if (orgId) {
    await prisma.$executeRaw`SELECT set_config('app.org_id', ${orgId}, false)`
  } else {
    await prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`
  }
  return prisma
}
```

- [ ] **Step 2: Sweep the 46 own-client scripts**

In each: replace `const prisma = new PrismaClient(…)` with:
```js
import { makeScriptPrisma } from "./_rls.mjs"   // adjust relative path for scripts/seeds/*
const prisma = await makeScriptPrisma()
```
(For `.ts` scripts run via tsx the same import works; if a script wraps creation in a function, await the factory at the same spot. Scripts that construct clients with custom datasource URLs keep their URL — apply the same two set_config lines manually and note it for the classifier allowlist ONLY if the helper genuinely can't be used.)

Classification decision (spec §8 closed): **all 46 are bypass** — they are operator-run seeds/backfills/migrations that write explicit `organizationId` values. Per-tenant seeds (`seeds/mars.mjs`, `seeds/afigroup.mjs`, `seed-tenant-demo.mjs`) MAY use `makeScriptPrisma({ orgId })` later; not required for this plan.

- [ ] **Step 3: Sweep the 8 singleton-importing scripts**

Scripts importing `src/lib/prisma` use the ALS extension → wrap their `main()` body: `import { runWithRlsBypass } from "../src/lib/rls-context"` (adjust path) and `await runWithRlsBypass(() => main())` at the invocation point.

- [ ] **Step 4: Verify**

Run: `grep -rln "new PrismaClient" scripts/ --include="*.mjs" --include="*.ts" --include="*.js" | xargs grep -L "_rls.mjs"` → empty (every own-client script imports the helper; `_rls.mjs` itself is the only `new PrismaClient` holder).
Run one harmless script against dev DB as smoke (e.g. `npx tsx scripts/check-fb-token.mjs --help` or a read-only one) → boots without error.

- [ ] **Step 5: Commit**

```bash
git add scripts/
git commit -m "feat(rls): scripts/_rls.mjs session-bypass factory (connection_limit=1) + sweep 46 own-client scripts + 8 singleton-importing scripts"
```

---

### Task 10: Webhooks, public pages, admin pages sweep

**Files (enumerated; re-grep before editing — the classifier in Task 11 is the safety net):**
- Webhook routes (resolve org FROM payload/token): `src/app/api/v1/webhooks/{facebook,instagram,telegram,vkontakte,whatsapp,meta-social,sms-inbound,meeting-recap}/route.ts`, `src/app/api/chat/webhook/route.ts`, `src/app/api/v1/calls/webhook/route.ts`, `src/app/api/v1/payment-webhooks/[provider]/route.ts`, `src/app/api/v1/public/email-inbound/route.ts`, `src/app/api/v1/public/resend-webhook/route.ts` (skip `webhooks/manage` if it uses `requireAuth` — verify). For `meeting-recap`: keep its `x-meeting-webhook-secret` check byte-identical (INCLUDING the full three-link `MEETING_WEBHOOK_SECRET || CRON_SECRET || ""` fallback at route line ~38 — an existing integrator authenticates with it), then wrap everything after the secret check in `runWithTenant(orgId, …)` (`orgId` comes from the body; the `organization.findUnique` existence check stays as-is — `organizations` is a global table).
- Public pages/routes (token/slug → org, no auth): `src/app/s/[slug]/…`, `src/app/s/unsubscribe/…`, `src/app/f/[slug]/…`, `src/app/(public)/p/[slug]/…`, `src/app/(public)/events/…`, `src/app/(public)/_custom-domain/…`, `src/app/c/[token]/…`, `src/app/embed/chat/[key]/…` (+ their public API endpoints under `src/app/api/v1/public/*` that query before org context — enumerate with the classifier grep)
- Admin server pages (direct prisma, superadmin-gated): `src/app/admin/page.tsx`, `src/app/admin/plans/page.tsx`, `src/app/admin/tenants/page.tsx`, `src/app/admin/tenants/[id]/page.tsx`

- [ ] **Step 1: Apply the two-phase pattern to every webhook route**

The pattern (worked example — adapt names per file; this is the canonical shape, repeat it in each route):

```ts
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  // …signature/secret verification stays first, unchanged…
  const payload = await req.json()

  // Phase 1 — org resolution (cross-tenant lookup by external identifier):
  const channel = await runWithRlsBypass(() =>
    prisma.channelConfig.findFirst({ where: { externalId: payload.entry?.[0]?.id /* per-provider field */ } })
  )
  if (!channel) return NextResponse.json({ ok: true }) // unknown sender — ack and drop

  // Phase 2 — ALL remaining handler work runs tenant-scoped:
  return runWithTenant(channel.organizationId, async () => {
    // …entire existing handler body unchanged…
  })
}
```

Rules: bypass scope MUST contain ONLY the resolution lookup(s); everything after resolution goes under `runWithTenant(resolvedOrgId, …)` (`.run()` form — webhooks are not the guard path). If a handler's existing code resolves the org midway, hoist the resolution to the top rather than spreading bypass scope.

- [ ] **Step 2: Apply the same pattern to public pages**

Worked example for `src/app/s/[slug]/page.tsx` (adapt per page):

```ts
const survey = await runWithRlsBypass(() =>
  prisma.survey.findFirst({ where: { publicSlug: slug }, select: { id: true, organizationId: true } })
)
if (!survey) notFound()
return runWithTenant(survey.organizationId, () => renderSurveyPage(survey.id))
```

For pages whose data layer lives in API routes (`/api/v1/public/*`), apply the pattern in the route instead of the RSC.

- [ ] **Step 3: Admin pages**

Each of the 4 pages already gates on superadmin (`isSuperAdminSession` or equivalent — verify per file; add the check if a page relies only on middleware). Wrap their prisma work: `const tenants = await runWithRlsBypass(() => prisma.organization.findMany(…))`. Server components are not the HTTP-guard path → `.run()` form, never `enterRlsBypass`.

- [ ] **Step 4: Verify**

Run: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → 0 errors.
Run: `npm test` → failures ≤ baseline 5.
Manual smoke (dev server): open one public survey URL and one form URL — they render; trigger one webhook with curl (signature-stubbed dev mode) — 200.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(rls): webhooks + public pages + admin pages — bypass org-resolution then runWithTenant scoped handling"
```

---

### Task 11: CI totality classifier (`rls-bypass-classifier.test.ts`)

Written LAST among code tasks — it enforces that Tasks 6–10 actually covered the universe, and fails on any future unclassified surface.

**Files:**
- Test: `src/__tests__/rls-bypass-classifier.test.ts`

- [ ] **Step 1: Write the classifier**

```ts
// src/__tests__/rls-bypass-classifier.test.ts
// Totality guarantee for the RLS bypass inventory (spec §5/§6). Every
// cross-tenant surface must be CLASSIFIED — an unclassified surface fails CI
// with an actionable message. Mirrors the module-catalog totality discipline.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")

function walk(dir: string, filter: (f: string) => boolean, acc: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return acc
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name)
    if (e.isDirectory()) walk(rel, filter, acc)
    else if (filter(rel)) acc.push(rel)
  }
  return acc
}

/** Cron-shaped routes OUTSIDE /api/cron that adopt requireCronAuth. Additions require classification here. */
const EXTRA_CRON_ROUTES = [
  "src/app/api/v1/social/cron/poll-all/route.ts",
  "src/app/api/v1/journeys/process/route.ts",
]
/** Routes allowed to reference CRON_SECRET without requireCronAuth (own-secret webhooks with a CRON_SECRET env fallback). */
const CRON_SECRET_FALLBACK_ALLOWLIST = [
  "src/app/api/v1/webhooks/meeting-recap/route.ts", // x-meeting-webhook-secret primary; classified as webhook (runWithTenant)
]

describe("RLS bypass classifier (totality)", () => {
  it("every /api/cron route uses the requireCronAuth choke point", () => {
    const routes = walk("src/app/api/cron", (f) => f.endsWith("route.ts"))
    expect(routes.length).toBeGreaterThanOrEqual(30)
    const offenders = routes.filter((r) => !read(r).includes("requireCronAuth"))
    expect(offenders, `cron routes missing requireCronAuth: ${offenders.join(", ")}`).toEqual([])
  })

  it("no route outside the choke point hand-rolls CRON_SECRET", () => {
    const all = walk("src/app/api", (f) => f.endsWith("route.ts"))
    const offenders = all.filter(
      (r) =>
        !CRON_SECRET_FALLBACK_ALLOWLIST.includes(r) &&
        read(r).includes("CRON_SECRET") &&
        !read(r).includes("requireCronAuth")
    )
    expect(offenders, `routes with inline CRON_SECRET (use requireCronAuth): ${offenders.join(", ")}`).toEqual([])
  })

  it("CRON_SECRET-fallback allowlist entries exist and are webhook-classified", () => {
    for (const r of CRON_SECRET_FALLBACK_ALLOWLIST) {
      expect(existsSync(join(ROOT, r)), `${r} moved/deleted — update CRON_SECRET_FALLBACK_ALLOWLIST`).toBe(true)
      expect(read(r), `${r} must be tenant-scoped via runWithTenant`).toContain("runWithTenant")
    }
  })

  it("cron-shaped routes outside /api/cron are classified", () => {
    for (const r of EXTRA_CRON_ROUTES) {
      expect(existsSync(join(ROOT, r)), `${r} moved/deleted — update EXTRA_CRON_ROUTES`).toBe(true)
      expect(read(r), `${r} must use requireCronAuth`).toContain("requireCronAuth")
    }
  })

  it("no `new PrismaClient` under src/ outside src/lib/prisma.ts (catches future timer/route clients)", () => {
    const files = walk("src", (f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
    const offenders = files.filter((f) => f !== "src/lib/prisma.ts" && read(f).includes("new PrismaClient"))
    expect(offenders, `own PrismaClient instances bypass the RLS extension: ${offenders.join(", ")}`).toEqual([])
  })

  it("every scripts/* file with its own PrismaClient goes through scripts/_rls.mjs", () => {
    const files = walk("scripts", (f) => /\.(mjs|ts|js)$/.test(f))
    const offenders = files.filter(
      (f) => f !== "scripts/_rls.mjs" && read(f).includes("new PrismaClient") && !read(f).includes("_rls.mjs")
    )
    expect(offenders, `scripts with raw PrismaClient (import makeScriptPrisma from scripts/_rls.mjs): ${offenders.join(", ")}`).toEqual([])
  })

  it("scripts importing the app singleton wrap with runWithRlsBypass/runWithTenant", () => {
    const files = walk("scripts", (f) => /\.(mjs|ts|js)$/.test(f))
    const offenders = files.filter((f) => {
      const src = read(f)
      return /from ["'].*lib\/prisma["']/.test(src) && !/runWithRlsBypass|runWithTenant/.test(src)
    })
    expect(offenders, `singleton-importing scripts without RLS scope: ${offenders.join(", ")}`).toEqual([])
  })

  it("public surfaces that query prisma are classified (runWithTenant or runWithRlsBypass present)", () => {
    const roots = ["src/app/s", "src/app/f", "src/app/c", "src/app/embed", "src/app/(public)", "src/app/api/v1/public"]
    const files = roots.flatMap((r) => walk(r, (f) => /(page|route)\.tsx?$/.test(f)))
    const offenders = files.filter((f) => {
      const src = read(f)
      const usesPrisma = /from ["']@\/lib\/prisma["']|prisma\./.test(src)
      return usesPrisma && !/runWithTenant|runWithRlsBypass|requireAuth|getOrgId/.test(src)
    })
    expect(offenders, `public surfaces querying prisma without RLS classification: ${offenders.join(", ")}`).toEqual([])
  })

  it("admin server pages with direct prisma are bypass-classified", () => {
    const files = walk("src/app/admin", (f) => f.endsWith("page.tsx"))
    const offenders = files.filter((f) => {
      const src = read(f)
      return /prisma\./.test(src) && !/runWithRlsBypass/.test(src)
    })
    expect(offenders, `admin pages with unclassified prisma: ${offenders.join(", ")}`).toEqual([])
  })

  it("webhook inbound routes are classified", () => {
    const dirs = [
      "src/app/api/v1/webhooks", "src/app/api/chat/webhook",
      "src/app/api/v1/calls/webhook", "src/app/api/v1/payment-webhooks",
    ]
    const files = dirs.flatMap((d) => walk(d, (f) => f.endsWith("route.ts")))
    const offenders = files.filter((f) => {
      const src = read(f)
      const usesPrisma = /prisma\./.test(src)
      // requireAuth-gated management routes are classified by the guard itself
      return usesPrisma && !/runWithTenant|runWithRlsBypass|requireAuth|requireCronAuth/.test(src)
    })
    expect(offenders, `webhook routes with unclassified prisma: ${offenders.join(", ")}`).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/__tests__/rls-bypass-classifier.test.ts`
Expected: PASS. Every failure message names the offender file and the fix — resolve by classifying (NOT by weakening the test).

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test` → failures ≤ baseline 5. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/rls-bypass-classifier.test.ts
git commit -m "test(rls): totality classifier — cron choke point, PrismaClient containment, scripts, public surfaces, webhooks, admin pages"
```

---

### Task 12: Runbook + docs + memory

**Files:**
- Create: `docs/rls-rollout-runbook.md`
- Modify: `docs/ARCHITECTURE.md` (one pointer line in the security/tenancy section)
- Modify: memory `project_rls_tenant_isolation.md` (state: plan executed, awaiting rollout)

- [ ] **Step 1: Write the runbook**

```markdown
# RLS Rollout Runbook (Postgres tenant isolation)

Plan: docs/superpowers/plans/2026-06-10-postgres-rls-tenant-isolation.md
Spec: docs/superpowers/specs/2026-06-10-postgres-rls-tenant-isolation-design.md
Deploy target: ALWAYS ask which client first (clients/registry.json). Shared box first; per-client boxes after soak.

## Phase 0 — preflight (on the server, BEFORE enabling anything)
1. `psql -h localhost -U hermes -d leaddrive_v2 -c "SELECT tableowner FROM pg_tables WHERE schemaname='public' LIMIT 3"` → confirm owner (FORCE is required if hermes owns the tables; harmless either way).
2. `psql -h localhost -U hermes -d leaddrive_v2 -c "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='hermes'"` → BOTH must be `f` (superuser/BYPASSRLS would bypass every policy).
3. `node --version` on the server → re-run the ALS spike shape if it differs from Node 20: `node scripts/rls/spike-extension-mechanics.mjs` against a scratch DB (`createdb rls_spike`).
4. `node scripts/rls/generate-rls-policies.mjs --dry-run` → table count ≈300, batch composition sane, batch-1 = low-risk lookups, final batch = users/api_keys.

## Phase 1 — ship plumbing (RLS enabled on ZERO tables)
Deploy the branch normally (standalone-build gotchas per CLAUDE.md: copy .next/static, public/*, Prisma engine). Pure no-op for the DB.
Soak ≥1 day: watch PM2 logs for `[rls]` dev-warnings (should be none in prod mode), login/cron/webhook behavior unchanged. `/api/v1/ping` → {"ok":true}.

## Phase 2 — batch 1 (5 low-risk tables)
1. `node scripts/rls/generate-rls-policies.mjs` (writes scripts/rls/*.sql) — commit the generated SQL.
2. `psql -h localhost -U hermes -d leaddrive_v2 -f scripts/rls/enable-batch-1.sql`
3. Smoke on demo tenants (mars, afigroup): login, sidebar, settings pages backed by those lookup tables, one cron via curl, one public survey page.
4. Symptom of a missed surface = EMPTY LIST where data exists (fail-closed, not a leak). Rollback: `psql … -f scripts/rls/disable-batch-1.sql` (instant).

## Phase 3 — middle batches (2…N-1)
Enable one batch at a time; between batches run the demo-tenant smoke: login, leads/deals/contacts CRUD, inbox, notifications, exports, one manual cron, one webhook, MTM mobile sync.

## Phase 4 — final batch (users, api_keys) — auth-critical
Enable last, off-peak. IMMEDIATELY verify: credentials login, OAuth login, API-key call, mobile JWT call, cron, superadmin /admin/tenants. Rollback file ready in the same terminal.

## Phase 5 — soak before zeytunpharm
Full E2E pass + one week of normal demo-tenant usage with clean logs; only then onboard live-client data.

## Residual risks (accepted, documented)
- Session-var bypass is defeatable by SQL injection — RLS here defends against app-logic bugs (forgotten where organizationId), not injection; app layers remain the injection defense (spec §9).
- FK existence can leak via constraint errors; TRUNCATE bypasses RLS; organizations is a global table (no organizationId column → no policy).
- Upgrade path if an auditor demands injection-resistant isolation: two-role split (spec D1 alternative).
```

- [ ] **Step 2: ARCHITECTURE.md pointer**

Add one line to the tenancy/security section: `- DB-level tenant isolation: Postgres RLS (fail-closed). Rollout/rollback: docs/rls-rollout-runbook.md; design: docs/superpowers/specs/2026-06-10-postgres-rls-tenant-isolation-design.md.`

- [ ] **Step 3: Commit + push**

```bash
git add docs/
git commit -m "docs(rls): rollout runbook (phased enable, instant rollback, preflight role checks) + ARCHITECTURE pointer"
git push origin feat/rls-tenant-isolation
```

- [ ] **Step 4: Update memory** — `project_rls_tenant_isolation.md`: state → "plan executed on feat/rls-tenant-isolation @ <sha>, ALL code tasks done, NEXT = Phase-1 deploy (ask target!) then batched enable per runbook".

---

## Spec coverage self-check (spec § → task)

| Spec item | Task |
|---|---|
| §3.D1 policy USING+WITH CHECK, fail-closed, generator | 3 (+5 proves) |
| §3.D2 ALS + extension, $transaction override, raw coverage, enterWith mechanics | 1, 2, 4 |
| §3.D2 125 interactive tx + batch form | 2 (gate), 4, 5 |
| §3.D3 scripts helper, connection_limit=1, per-script classification | 9 |
| §3.D4 batched rollout + instant rollback | 3, 12 |
| §3.D5 fail-closed + dev warning | 1, 4, 5 |
| §4 generator over information_schema, exclusions | 3 |
| §5 bypass inventory: auth.ts login | 6 |
| §5 superadmin API + /admin pages | 6, 10 |
| §5 34 crons (choke point pinned) | 7 |
| §5 46 scripts | 9 |
| §5 webhooks two-phase | 10 |
| §5 instrumentation timers (.run) | 8 |
| §5 7 public RSC pages (+events found) | 10 |
| §5 tenant export/purge/provisioning (superadmin-gated routes) | covered by 6 (requireSuperAdmin bypass) + classifier 11 |
| §6 unit / classifier / integration / E2E | 1,4 / 11 / 5 / 12 runbook |
| §7 risk closures | 4 (warn), 5 (matrix), 7 (cron), 11 (rot), 12 (rollback) |
| §8 hermes owner check | 12 Phase 0 |
| §8 cron choke point decision | addenda + 7 |
| §8 per-script classification | 9 (all bypass; orgId option) |
| §8 dev/test PG provisioning | 2, 5 (docker, env-gated) |
| §8 mtm_db follow-up | explicitly out of scope (spec non-goal) |
| §9 Codex second opinion on mechanics | obtained, findings in addenda; spike = Task 2 |
