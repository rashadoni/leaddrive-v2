// Repro for the 2026-06-11 empty-CRM incident hypothesis B: does the per-op
// batch wrap (basePrisma.$transaction([setCfg, query(args)])) compose for MODEL
// ops (prisma.deal.count/findMany) the same way it does for raw $queryRaw?
// Uses the REAL src/lib/prisma client against a pgvector scratch DB.
// Run: RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres \
//        npx vitest run src/__tests__/rls-modelop-repro.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"

const url = process.env.RLS_TEST_DATABASE_URL

describe.skipIf(!url)("RLS model-op vs raw-op repro (real prisma client)", () => {
  let prisma: any
  let runWithTenant: any
  let runWithRlsBypass: any
  let enterTenantContext: any
  let base: any
  const ORG_A = "org-a-modelop"
  const ORG_B = "org-b-modelop"

  const APP_URL = url ? url.replace("postgres:rls@", "rls_app:rls_app_pw@") : ""

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client")
    base = new PrismaClient({ datasourceUrl: url }) // superuser — DDL + seed only
    // non-superuser app role that OWNS deals so FORCE RLS binds to it (mirrors prod hermes)
    await base.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rls_app') THEN
        CREATE ROLE rls_app LOGIN PASSWORD 'rls_app_pw' NOSUPERUSER NOBYPASSRLS;
      END IF; END $$`)
    await base.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO rls_app`)
    await base.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO rls_app`)
    await base.$executeRawUnsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO rls_app`)
    // seed (superuser, no RLS active yet)
    await base.$executeRawUnsafe(`DELETE FROM deals WHERE id LIKE 'modelop-%'`)
    await base.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN ('${ORG_A}','${ORG_B}')`)
    await base.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, "updatedAt") VALUES
      ('${ORG_A}','A','a-modelop',now()), ('${ORG_B}','B','b-modelop',now())`)
    for (let i = 0; i < 5; i++) await base.$executeRawUnsafe(
      `INSERT INTO deals (id, "organizationId", name, "updatedAt") VALUES ('modelop-a${i}','${ORG_A}','dA${i}',now())`)
    for (let i = 0; i < 2; i++) await base.$executeRawUnsafe(
      `INSERT INTO deals (id, "organizationId", name, "updatedAt") VALUES ('modelop-b${i}','${ORG_B}','dB${i}',now())`)
    // enable RLS on deals exactly like the generator emits, then hand ownership to rls_app
    await base.$executeRawUnsafe(`ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY`)
    await base.$executeRawUnsafe(`ALTER TABLE "deals" FORCE ROW LEVEL SECURITY`)
    await base.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "deals"`)
    await base.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "deals"
      USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
      WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')`)
    await base.$executeRawUnsafe(`ALTER TABLE "deals" OWNER TO rls_app`)

    // sanity: confirm the app role really is non-superuser (else RLS is silently bypassed)
    const who = await base.$queryRawUnsafe(
      `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname='rls_app') AS super`)
    if (who[0].super !== false) throw new Error("rls_app must be NOSUPERUSER or the test is meaningless")

    // NOW load the REAL app prisma client, bound to the non-superuser role
    process.env.DATABASE_URL = APP_URL
    const { vi } = await import("vitest")
    vi.resetModules()
    delete (globalThis as any).prisma
    delete (globalThis as any).__rlsStorage
    const mod = await import("@/lib/prisma")
    prisma = mod.prisma
    const ctx = await import("@/lib/rls-context")
    runWithTenant = ctx.runWithTenant
    runWithRlsBypass = ctx.runWithRlsBypass
    enterTenantContext = ctx.enterTenantContext
  })

  afterAll(async () => {
    if (!base) return
    await base.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "deals"`).catch(() => {})
    await base.$executeRawUnsafe(`ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY`).catch(() => {})
    await base.$executeRawUnsafe(`ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY`).catch(() => {})
    await base.$executeRawUnsafe(`DELETE FROM deals WHERE id LIKE 'modelop-%'`).catch(() => {})
    await base.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN ('${ORG_A}','${ORG_B}')`).catch(() => {})
    await base.$disconnect()
  })

  it("baseline: no-context model op is fail-closed (0)", async () => {
    const onlyOurs = async () => {
      const r = await runWithRlsBypass(() => prisma.deal.count({ where: { id: { startsWith: "modelop-" } } }))
      return r
    }
    expect(await onlyOurs()).toBe(7) // bypass sees all 7
    // no context → fail-closed
    expect(await prisma.deal.count({ where: { id: { startsWith: "modelop-" } } })).toBe(0)
  })

  it("RAW op under runWithTenant sees org-A rows (the path the diag already proved)", async () => {
    const n = await runWithTenant(ORG_A, async () => {
      const r = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM deals WHERE id LIKE 'modelop-%'`
      return Number(r[0].n)
    })
    expect(n).toBe(5)
  })

  it("KEY: MODEL op count under runWithTenant (.run path)", async () => {
    const n = await runWithTenant(ORG_A, () => prisma.deal.count({ where: { id: { startsWith: "modelop-" } } }))
    // If this is 0 while raw was 5 → per-op batch wrap does NOT compose for model ops.
    expect(n).toBe(5)
  })

  it("KEY: MODEL op findMany under runWithTenant", async () => {
    const rows = await runWithTenant(ORG_A, () => prisma.deal.findMany({ where: { id: { startsWith: "modelop-" } }, select: { id: true } }))
    expect(rows.length).toBe(5)
  })

  it("ANTI-PATTERN: bare PrismaPromise returned from the enterWith callee → fail-closed (documents the trap)", async () => {
    // This is what rls-context forbids: the promise is created in the callee
    // frame but awaited OUTSIDE it. Expected to fail-closed (0) — NOT the real path.
    const n = await (async () => {
      enterTenantContext(ORG_A)
      return prisma.deal.count({ where: { id: { startsWith: "modelop-" } } })
    })()
    expect(n).toBe(0)
  })

  it("KEY: REAL getSession shape — guard returns DATA (enterWith), query created+awaited in the continuation", async () => {
    // Mirrors getSession: guard does enterWith + returns the orgId (data, not a
    // promise); the route then builds AND awaits the model op in the continuation.
    const guard = async () => { enterTenantContext(ORG_A); return ORG_A }
    await guard() // enterWith propagates to this continuation
    const n = await prisma.deal.count({ where: { id: { startsWith: "modelop-" } } })
    expect(n).toBe(5)
  })

  it("KEY: REAL getSession shape — findMany in the continuation", async () => {
    const guard = async () => { enterTenantContext(ORG_A); return ORG_A }
    await guard()
    const rows = await prisma.deal.findMany({ where: { id: { startsWith: "modelop-" } }, select: { id: true } })
    expect(rows.length).toBe(5)
  })

  it("KEY: getSession shape with an await BETWEEN guard and query (real routes await other things first)", async () => {
    const guard = async () => { enterTenantContext(ORG_A); return ORG_A }
    await guard()
    await new Promise((r) => setTimeout(r, 5)) // a real route awaits other work between
    const n = await prisma.deal.count({ where: { id: { startsWith: "modelop-" } } })
    expect(n).toBe(5)
  })
})
