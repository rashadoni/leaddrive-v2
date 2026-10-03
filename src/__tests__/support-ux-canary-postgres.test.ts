import { randomBytes } from "node:crypto"
import type { PrismaClient, Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// An explicit, isolated CI database is required before connecting or issuing DDL.
// The normal unit suite skips this file. This gate never accepts an app DATABASE_URL.
const configuredUrl = process.env.SUPPORT_UX_CANARY_TEST_DATABASE_URL
const DATABASE = "support_ux_canary_test"
const SHA = "f62ab3a609a0461cbd14c264306df2d28325628f"
const FLAG = "support_ux_v2_canary"
const ORG_A = "support-canary-org-a"
const ORG_B = "support-canary-org-b"
const SLUG_A = "support-canary-a"
const ACTOR = "support-canary-operator"

function guardedUrl(value: string): URL {
  try {
    const url = new URL(value)
    if (process.env.CI !== "true" || !["postgresql:", "postgres:"].includes(url.protocol)
      || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username !== "postgres"
      || !url.port || Number(url.port) < 1
      || url.pathname !== `/${DATABASE}` || url.search || url.hash) throw new Error()
    return url
  } catch {
    throw new Error("SUPPORT_UX_CANARY_TEST_CONTEXT_REQUIRED")
  }
}

const scratchUrl = configuredUrl ? guardedUrl(configuredUrl) : null
const session = vi.hoisted(() => ({
  actor: { orgId: "support-canary-operator-org", userId: "support-canary-operator", role: "superadmin" },
}))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn(async () => session.actor) }))
vi.mock("@/generated/build-sha", () => ({ DEPLOY_SHA: "f62ab3a609a0461cbd14c264306df2d28325628f" }))

type OrganizationState = {
  id: string; slug: string; isActive: boolean; features: Prisma.JsonValue
  modules: Prisma.JsonValue; settings: Prisma.JsonValue; updatedAt: Date
}
type AuditState = {
  organizationId: string; userId: string; action: string; entityType: string
  entityId: string; entityName: string; oldValue: Prisma.JsonValue; newValue: Prisma.JsonValue
}
type Receipt = {
  enabled: boolean; changed: boolean; artifactSha: string; auditId: string
  auditRecordedAtUtc: string; receiptIssuedAtUtc: string
}

describe.skipIf(!scratchUrl)("Support canary real PostgreSQL atomicity and RLS", () => {
  let control: PrismaClient | undefined
  let admin: PrismaClient | undefined
  let unscopedApp: PrismaClient | undefined
  let app: typeof import("@/lib/prisma").prisma | undefined
  let post: typeof import("@/app/api/v1/admin/tenants/[id]/support-ux-canary/route").POST
  let createdDatabase = false
  let createdRole = false
  const role = `support_canary_app_${randomBytes(12).toString("hex")}`
  const password = randomBytes(32).toString("hex")
  const previousDatabaseUrl = process.env.DATABASE_URL
  const globals = globalThis as typeof globalThis & { prisma?: unknown; __rlsStorage?: unknown }
  const previousPrisma = globals.prisma
  const previousRlsStorage = globals.__rlsStorage

  async function ddl(client: PrismaClient, statement: string) {
    // Recheck the fixed CI-only target before every schema/role/database change.
    guardedUrl(configuredUrl!)
    if (process.env.SUPPORT_UX_CANARY_TEST_DATABASE_URL !== configuredUrl) {
      throw new Error("SUPPORT_UX_CANARY_TEST_CONTEXT_REQUIRED")
    }
    return client.$executeRawUnsafe(statement)
  }
  async function states(): Promise<OrganizationState[]> {
    return admin!.$queryRaw<OrganizationState[]>`
      SELECT id, slug, "isActive", features, modules, settings, "updatedAt"
      FROM public.organizations ORDER BY id`
  }
  async function audits(): Promise<AuditState[]> {
    return admin!.$queryRaw<AuditState[]>`
      SELECT "organizationId", "userId", action, "entityType", "entityId", "entityName", "oldValue", "newValue"
      FROM public.audit_logs ORDER BY "createdAt", id`
  }
  async function request(enabled: boolean, expectedEnabled: boolean, overrides: Record<string, unknown> = {}) {
    return post(new NextRequest(`http://localhost:3000/api/v1/admin/tenants/${ORG_A}/support-ux-canary`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug: SLUG_A, enabled, expectedEnabled, expectedArtifactSha: SHA, ...overrides }),
    }), { params: Promise.resolve({ id: ORG_A }) })
  }
  async function seed(features: Prisma.JsonValue = ["crm", "support", "crm", null, { future: ["entry"] }]) {
    await ddl(admin!, "TRUNCATE public.audit_logs, public.organizations")
    await admin!.$executeRaw`
      INSERT INTO public.organizations (id, slug, "isActive", features, modules, settings, "updatedAt")
      VALUES (${ORG_A}, ${SLUG_A}, true, ${JSON.stringify(features)}::jsonb,
        '{"support":true,"unrelated":"preserve-a"}'::jsonb,
        '{"macroCategories":["keep-a"],"unrelated":{"value":7}}'::jsonb, now()),
        (${ORG_B}, 'support-canary-b', true, '["crm","sentinel-b"]'::jsonb,
        '{"unrelated":"preserve-b"}'::jsonb, '{"macroCategories":["keep-b"]}'::jsonb, now())`
  }

  beforeAll(async () => {
    const validated = guardedUrl(configuredUrl!)
    const controlUrl = new URL(validated); controlUrl.pathname = "/postgres"
    const { PrismaClient: Client } = await import("@prisma/client")
    control = new Client({ datasourceUrl: controlUrl.toString() })
    let setupPhase = "database-preflight"
    try {
      // Never reset somebody else's existing scratch database.
      const existing = await control.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${DATABASE}) AS present`
      if (existing[0]?.present !== false) throw new Error()
      setupPhase = "database-create"
      await ddl(control, `CREATE DATABASE "${DATABASE}"`)
      createdDatabase = true
      admin = new Client({ datasourceUrl: validated.toString() })
      setupPhase = "role-create"
      await ddl(control, `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`)
      createdRole = true
      setupPhase = "tables-create"
      await ddl(admin, `CREATE TABLE public.organizations (
        id text PRIMARY KEY, slug text UNIQUE NOT NULL, "isActive" boolean NOT NULL,
        features jsonb NOT NULL, modules jsonb NOT NULL, settings jsonb NOT NULL,
        "updatedAt" timestamp(3) NOT NULL)`)
      await ddl(admin, `CREATE TABLE public.audit_logs (
        id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES public.organizations(id),
        "userId" text, action text NOT NULL, "entityType" text NOT NULL,
        "entityId" text, "entityName" text, "oldValue" jsonb, "newValue" jsonb,
        "ipAddress" text, "userAgent" text, "createdAt" timestamp(3) NOT NULL DEFAULT now())`)
      setupPhase = "rls-setup"
      for (const [table, tenantColumn] of [["organizations", "id"], ["audit_logs", "organizationId"]]) {
        await ddl(admin, `ALTER TABLE public."${table}" OWNER TO "${role}"`)
        await ddl(admin, `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`)
        await ddl(admin, `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`)
        await ddl(admin, `CREATE POLICY tenant_isolation ON public."${table}"
          USING ("${tenantColumn}" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
          WITH CHECK ("${tenantColumn}" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')`)
      }
      await ddl(admin, `GRANT USAGE ON SCHEMA public TO "${role}"`)
      setupPhase = "client-setup"
      const appUrl = new URL(validated)
      appUrl.username = role; appUrl.password = password
      appUrl.searchParams.set("connection_limit", "4")
      unscopedApp = new Client({ datasourceUrl: appUrl.toString() })
      process.env.DATABASE_URL = appUrl.toString()
      vi.resetModules()
      delete globals.prisma
      delete globals.__rlsStorage
      app = (await import("@/lib/prisma")).prisma
      post = (await import("@/app/api/v1/admin/tenants/[id]/support-ux-canary/route")).POST
    } catch {
      // DDL errors can contain connection details/passwords; export only a fixed failure.
      throw new Error(`SUPPORT_UX_CANARY_POSTGRES_SETUP_FAILED:${setupPhase}`)
    }
  })

  beforeEach(async () => {
    await ddl(admin!, "ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS force_canary_audit_failure")
    await seed()
  })

  afterAll(async () => {
    try {
      const disconnections = await Promise.allSettled([
        app?.$disconnect(), unscopedApp?.$disconnect(), admin?.$disconnect(),
      ])
      if (disconnections.some((result) => result.status === "rejected")) throw new Error()
      if (control && createdDatabase) {
        await ddl(control, `DROP DATABASE "${DATABASE}"`)
      }
      if (control && createdRole) await ddl(control, `DROP ROLE "${role}"`)
    } catch {
      throw new Error("SUPPORT_UX_CANARY_POSTGRES_CLEANUP_FAILED")
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousPrisma === undefined) delete globals.prisma
      else globals.prisma = previousPrisma
      if (previousRlsStorage === undefined) delete globals.__rlsStorage
      else globals.__rlsStorage = previousRlsStorage
      try {
        await control?.$disconnect()
      } catch {
        throw new Error("SUPPORT_UX_CANARY_POSTGRES_CLEANUP_FAILED")
      }
    }
  })

  it("uses a non-superuser/non-bypass role with FORCE RLS on both real tables", async () => {
    const privileges = await unscopedApp!.$queryRaw<{ super: boolean; bypass: boolean }[]>`
      SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`
    expect(privileges).toEqual([{ super: false, bypass: false }])
    const policies = await admin!.$queryRaw<{ name: string; enabled: boolean; forced: boolean }[]>`
      SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('organizations', 'audit_logs') ORDER BY relname`
    expect(policies).toEqual([
      { name: "audit_logs", enabled: true, forced: true },
      { name: "organizations", enabled: true, forced: true },
    ])
    const rows = await unscopedApp!.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM public.organizations`
    expect(rows).toEqual([{ count: 0 }])
  })

  it("commits only the fixed flag and its actor-bound audit through the actual Prisma proxy", async () => {
    const before = await states()
    const response = await request(true, false)
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Receipt }
    expect(body.data).toMatchObject({ enabled: true, changed: true, artifactSha: SHA })
    expect(body.data.auditId).toEqual(expect.any(String))
    const after = await states()
    expect(after[0].features).toEqual([...(before[0].features as Prisma.JsonArray), FLAG])
    expect({ ...after[0], features: before[0].features, updatedAt: before[0].updatedAt }).toEqual(before[0])
    expect(after[1]).toEqual(before[1])
    expect(await audits()).toEqual([{
      organizationId: ORG_A, userId: ACTOR, action: "support_ux_canary_enable",
      entityType: "support_ux_canary", entityId: ORG_A, entityName: FLAG,
      oldValue: { enabled: false }, newValue: { enabled: true, changed: true, artifactSha: SHA },
    }])
  })

  it("rolls the feature update back when the real audit INSERT fails", async () => {
    const before = await states()
    await ddl(admin!, "ALTER TABLE public.audit_logs ADD CONSTRAINT force_canary_audit_failure CHECK (action <> 'support_ux_canary_enable')")
    const response = await request(true, false)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, code: "SUPPORT_UX_CHANGE_FAILED" })
    expect(await states()).toEqual(before)
    expect(await audits()).toEqual([])
  })

  it("preserves encoded storage and sentinel state when disabling the fixed flag", async () => {
    const features = JSON.stringify(["crm", FLAG, "crm", { unknown: true }, FLAG])
    await seed(features)
    const before = await states()
    expect((await request(false, true)).status).toBe(200)
    const after = await states()
    expect(after[0].features).toBe(JSON.stringify(["crm", "crm", { unknown: true }]))
    expect({ ...after[0], features: before[0].features, updatedAt: before[0].updatedAt }).toEqual(before[0])
    expect(after[1]).toEqual(before[1])
    expect((await audits())[0]).toMatchObject({ action: "support_ux_canary_disable", userId: ACTOR })
  })

  it("records an idempotent confirmation without inventing an original activation date", async () => {
    const features = ` [ "crm", "${FLAG}", "crm" ] `
    await seed(features)
    const before = await states()
    const response = await request(true, true)
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Receipt }
    expect(body.data).toMatchObject({ enabled: true, changed: false, artifactSha: SHA })
    expect(Object.keys(body.data).sort()).toEqual([
      "artifactSha", "auditId", "auditRecordedAtUtc", "changed", "enabled", "receiptIssuedAtUtc", "tenantSlug",
    ])
    expect(await states()).toEqual(before)
    expect((await audits())[0]).toMatchObject({ action: "support_ux_canary_confirm", oldValue: { enabled: true } })
  })

  it.each(["wrong-slug", "inactive", "unsupported", "stale-state"])("rejects %s without any write", async (kind) => {
    if (kind === "inactive") await admin!.$executeRaw`UPDATE public.organizations SET "isActive" = false WHERE id = ${ORG_A}`
    if (kind === "unsupported") await seed({ unsupported: true })
    const before = await states()
    const response = await request(true, kind === "stale-state", kind === "wrong-slug" ? { tenantSlug: "other-tenant" } : {})
    expect(response.status).toBe(kind === "wrong-slug" ? 404 : 409)
    expect(await states()).toEqual(before)
    expect(await audits()).toEqual([])
  })

  it("serializes concurrent expected-state transitions to one commit and one 409", async () => {
    const before = await states()
    let unlock!: () => void
    let locked!: () => void
    let lockFailed!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { locked = resolve; lockFailed = reject })
    const release = new Promise<void>((resolve) => { unlock = resolve })
    const blocker = admin!.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.organizations WHERE id = ${ORG_A} FOR UPDATE`
      locked()
      await release
    }, { timeout: 5000 })
    void blocker.catch(() => lockFailed(new Error("SUPPORT_UX_CANARY_TEST_LOCK_FAILED")))
    await ready
    const attempts = [request(true, false), request(true, false)]
    try {
      const deadline = Date.now() + 2500
      let waiting = 0
      while (waiting < 2 && Date.now() < deadline) {
        const rows = await admin!.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = ${DATABASE} AND usename = ${role}
            AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`
        waiting = rows[0].count
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(waiting).toBe(2)
      unlock()
      await blocker
      const responses = await Promise.all(attempts)
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      expect((await states())[0].features).toEqual([...(before[0].features as Prisma.JsonArray), FLAG])
      expect((await states())[1]).toEqual(before[1])
      expect(await audits()).toHaveLength(1)
      expect((await audits())[0].action).toBe("support_ux_canary_enable")
    } finally {
      unlock()
      await Promise.allSettled([blocker, ...attempts])
    }
  })
})
