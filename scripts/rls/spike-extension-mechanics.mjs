// scripts/rls/spike-extension-mechanics.mjs
// Proves Prisma 6.19.x mechanics for the RLS extension design (plan Task 2 gate).
// Gate verdict PASS verified on @prisma/client 6.19.3 (package.json range ^6.19.2).
// Usage: RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres node scripts/rls/spike-extension-mechanics.mjs
//
// EXEMPT from scripts/_rls.mjs (makeScriptPrisma): this spike deliberately builds raw
// clients against the scratch DB with custom datasource URLs — it TESTS transaction-local
// set_config mechanics, fail-closed (CHECK 2) and WITH CHECK (CHECK 5). A session-wide
// bypass from the helper would invalidate every check. Never points at a production DB.
import { PrismaClient } from "@prisma/client"
import { AsyncLocalStorage } from "node:async_hooks"

const url = process.env.RLS_TEST_DATABASE_URL
if (!url) { console.error("RLS_TEST_DATABASE_URL required"); process.exit(1) }

const als = new AsyncLocalStorage()
const hookLog = []

// Any FAIL verdict → non-zero exit so CI / the rollout runbook preflight can gate on it.
// Returns the string unchanged — console output stays byte-identical to the PASS path.
const verdict = (v) => {
  if (String(v).startsWith("FAIL")) process.exitCode = 1
  return v
}

// Superusers ALWAYS bypass RLS (plan addendum #3 residual), so checks must run as a
// non-superuser, non-owner role — mirrors prod app user `hermes` (runbook asserts
// NOSUPERUSER + NOBYPASSRLS). `admin` (superuser from RLS_TEST_DATABASE_URL) does DDL
// only; `base` — the client under test — connects as spike_app.
const admin = new PrismaClient({ datasourceUrl: url })
const appUrl = new URL(url)
appUrl.username = "spike_app"
appUrl.password = "spike"
const base = new PrismaClient({ datasourceUrl: appUrl.toString() })

async function main() {
  await admin.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spike_app') THEN
      CREATE ROLE spike_app LOGIN PASSWORD 'spike' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$`)
  await admin.$executeRawUnsafe(`DROP TABLE IF EXISTS spike_items`)
  await admin.$executeRawUnsafe(`CREATE TABLE spike_items (id serial PRIMARY KEY, "organizationId" text NOT NULL, name text)`)
  await admin.$executeRawUnsafe(`ALTER TABLE spike_items ENABLE ROW LEVEL SECURITY`)
  await admin.$executeRawUnsafe(`ALTER TABLE spike_items FORCE ROW LEVEL SECURITY`)
  await admin.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON spike_items`)
  await admin.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON spike_items
    USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
    WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')`)
  await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON spike_items TO spike_app`)
  await admin.$executeRawUnsafe(`GRANT USAGE, SELECT ON SEQUENCE spike_items_id_seq TO spike_app`)

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

  // CHECK 0 — sanity: the client under test must be a non-superuser, or every check below
  // is meaningless (superusers bypass RLS SILENTLY — checks would fail OPEN and look green).
  // Ported from the line-B spike (2026-06-10 verdict-conflict postmortem).
  const who = await base.$queryRawUnsafe(
    `SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super`
  )
  console.log("CHECK0 base role:", JSON.stringify(who),
    verdict(who[0].u === "spike_app" && who[0].super === false ? "PASS (non-superuser)" : "FAIL (RLS would be bypassed)"))

  // Seed under bypass
  await als.run({ bypass: true }, async () => {
    await extended.$executeRaw`INSERT INTO spike_items ("organizationId", name) VALUES ('org-a','a1'),('org-b','b1')`
  })

  // CHECK 1 — per-op wrap on raw + model-less ops: tenant sees only own rows
  // NOTE (spike finding): PrismaPromise is lazy — it executes at await/.then time, not at
  // construction. The await MUST happen inside the als.run callback or the hook sees no
  // context (fail-closed []). Production wrappers (runWithTenant / enterWith on the request
  // path) always await inside the context, so this only constrains the spike/test shape.
  const c1 = await als.run({ orgId: "org-a" }, async () => await extended.$queryRaw`SELECT name FROM spike_items ORDER BY name`)
  console.log("CHECK1 per-op raw isolation:", JSON.stringify(c1), verdict(c1.length === 1 && c1[0].name === "a1" ? "PASS" : "FAIL"))

  // CHECK 2 — no context → fail-closed (zero rows)
  const c2 = await extended.$queryRaw`SELECT name FROM spike_items`
  console.log("CHECK2 fail-closed:", JSON.stringify(c2), verdict(c2.length === 0 ? "PASS" : "FAIL"))

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
  console.log("CHECK3 interactive-tx isolation:", JSON.stringify(c3), verdict(c3.length === 1 ? "PASS" : "FAIL"))

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
    "results:", JSON.stringify(c4.slice(1)), verdict(batchSawInTx ? "PASS" : "FAIL → fallback: convert batch callsites"))

  // CHECK 5 — WITH CHECK blocks cross-tenant INSERT (await inside als.run — see CHECK 1 note —
  // so the org-a GUC is genuinely applied and the block is org-a ≠ org-b, not missing-context)
  let c5 = "FAIL (insert was allowed)"
  try {
    await als.run({ orgId: "org-a" }, async () => await extended.$executeRaw`INSERT INTO spike_items ("organizationId", name) VALUES ('org-b','evil')`)
  } catch (e) {
    c5 = /row-level security|violates/.test(String(e.message)) ? "PASS" : `FAIL (${e.message})`
  }
  console.log("CHECK5 WITH CHECK blocks cross-org insert:", verdict(c5))

  // CHECK 6 — LAZY-PROMISE REFUTATION PAIR (2026-06-10 postmortem, keep forever).
  // History: a parallel line ran CHECK1 with the await OUTSIDE als.run, got fail-closed [],
  // and misread it as Prisma #20678 ("extension-wrapped query escapes the array tx onto a
  // new connection"). This pair keeps the distinction executable:
  //   6a — await OUTSIDE the scope: the lazy PrismaPromise executes after run() exits → hook
  //        sees ctx=undefined → pass-through, NO set_config, NO tx → current_setting=''.
  //        That is a false fail-closed, NOT #20678 — there is no transaction to escape.
  //   6b — same query, await INSIDE: hook fires with ctx → [set_config, query] batch shares
  //        one backend → sees 'org-a'. Real #20678 would make 6b blind; it isn't.
  //   6c — explicit array-tx pair co-locates on one backend pid and sees the tx-local GUC
  //        (line-B's diagA, kept as the positive control for the batch mechanism itself).
  const d6a = await als.run({ orgId: "org-a" }, () =>
    extended.$queryRaw`SELECT current_setting('app.org_id', true) AS org, pg_backend_pid() AS pid`)
  const d6b = await als.run({ orgId: "org-a" }, async () =>
    await extended.$queryRaw`SELECT current_setting('app.org_id', true) AS org, pg_backend_pid() AS pid`)
  const d6c = await base.$transaction([
    base.$queryRaw`SELECT set_config('app.org_id', 'org-diag', true) AS s, pg_backend_pid() AS pid`,
    base.$queryRaw`SELECT current_setting('app.org_id', true) AS org, pg_backend_pid() AS pid`,
  ])
  const coloc = d6c[1][0].org === "org-diag" && String(d6c[0][0].pid) === String(d6c[1][0].pid)
  const pairOk = d6a[0].org === "" && d6b[0].org === "org-a" && coloc
  console.log("CHECK6 lazy-promise pair — await-outside sees:", JSON.stringify(d6a[0].org),
    "| await-inside sees:", JSON.stringify(d6b[0].org),
    "| explicit array-tx co-locates (same pid):", coloc,
    verdict(pairOk ? "PASS (false-FAIL shape documented; array-wrap sound)" : "FAIL"))

  await base.$disconnect()
  await admin.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
