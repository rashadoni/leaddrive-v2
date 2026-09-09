// src/__tests__/rls-integration.test.ts
// Real-Postgres isolation matrix. Skips entirely unless RLS_TEST_DATABASE_URL is set.
// Local rig: docker run -d --name rls-pg -e POSTGRES_PASSWORD=rls -p 55432:5432 postgres:16
//            RLS_TEST_DATABASE_URL=postgresql://postgres:rls@localhost:55432/postgres npx vitest run src/__tests__/rls-integration.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { emitEnableSql, emitDisableSql } from "../../scripts/rls/generate-rls-policies.mjs"

const url = process.env.RLS_TEST_DATABASE_URL

describe.skipIf(!url)("RLS integration (real Postgres)", () => {
  let prisma: any // the real exported client from src/lib/prisma — constructed against the scratch DB as rls_test_app
  let base: any // superuser client — DDL + seed ONLY (superusers ALWAYS bypass RLS; Task 2 gate adaptation #1)
  // Re-imported AFTER vi.resetModules() so the helpers and the freshly imported
  // prisma extension share ONE AsyncLocalStorage instance — a static import would
  // keep the stale pre-reset module (separate storage → context invisible to the
  // extension hook → every scoped query would falsely fail closed).
  let runWithTenant: typeof import("@/lib/rls-context").runWithTenant
  let runWithRlsBypass: typeof import("@/lib/rls-context").runWithRlsBypass

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client")
    base = new PrismaClient({ datasourceUrl: url })
    // The client under test must NOT be a superuser — superusers bypass RLS, FORCE
    // or not (Task 2 spike finding). rls_test_app mirrors prod `hermes`: LOGIN,
    // NOSUPERUSER, NOBYPASSRLS, and table OWNER (FORCE is what subjects the owner
    // to its own policies — regression-proven by the NO FORCE test below).
    await base.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_test_app') THEN
        CREATE ROLE rls_test_app LOGIN PASSWORD 'rls_test' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$`)
    await base.$executeRawUnsafe(`DROP TABLE IF EXISTS rls_deals`)
    await base.$executeRawUnsafe(`DROP TABLE IF EXISTS rls_globals`)
    await base.$executeRawUnsafe(`CREATE TABLE rls_deals (id serial PRIMARY KEY, "organizationId" text NOT NULL, title text)`)
    await base.$executeRawUnsafe(`CREATE TABLE rls_globals (id serial PRIMARY KEY, name text)`) // no organizationId — generator must skip it
    await base.$executeRawUnsafe(`ALTER TABLE rls_deals OWNER TO rls_test_app`) // column-owned sequences move with the table
    await base.$executeRawUnsafe(`GRANT USAGE, SELECT ON SEQUENCE rls_deals_id_seq TO rls_test_app`)
    for (const stmt of emitEnableSql(["rls_deals"]).split(";\n").map((s) => s.trim()).filter(Boolean)) {
      await base.$executeRawUnsafe(stmt)
    }
    await base.$executeRawUnsafe(`INSERT INTO rls_deals ("organizationId", title) VALUES ('org-a','A1'),('org-a','A2'),('org-b','B1')`)

    // Run this file STANDALONE (see header command): the singleton must bind to the
    // scratch DB as the app role, so clear any cached module/global client first.
    const appUrl = new URL(url as string)
    appUrl.username = "rls_test_app"
    appUrl.password = "rls_test"
    process.env.DATABASE_URL = appUrl.toString() // must be set BEFORE importing src/lib/prisma
    vi.resetModules()
    delete (globalThis as { prisma?: unknown }).prisma // src/lib/prisma caches on globalThis in non-prod
    const ctx = await import("@/lib/rls-context")
    runWithTenant = ctx.runWithTenant
    runWithRlsBypass = ctx.runWithRlsBypass
    const mod = await import("@/lib/prisma")
    prisma = mod.prisma
  })

  afterAll(async () => {
    for (const stmt of emitDisableSql(["rls_deals"]).split(";\n").map((s) => s.trim()).filter(Boolean)) {
      await base.$executeRawUnsafe(stmt).catch(() => {})
    }
    await prisma?.$disconnect?.().catch(() => {})
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
    // prisma connects as rls_test_app — the table OWNER. With RLS enabled but not
    // forced, the owner bypasses policies: the same unscoped no-context read that
    // fail-closed to [] above now leaks every row. (base is a superuser and would
    // leak FORCE-or-not, so the proof must run on the owner connection.)
    const rows = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM rls_deals`)
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
