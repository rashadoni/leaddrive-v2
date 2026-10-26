/**
 * Number -> organization on a real Postgres under the application's own role:
 * the PBX callbacks find a call's organization by the number dialled (first
 * event) or by the call (every later one), a number nobody holds stays with
 * the installation default, and the operator's screen refuses a number
 * another organization holds.
 *
 * Stood in for: the session cookie (a superadmin). Everything else is real —
 * the resolver, the admin route, the table's FORCE row-level security.
 *
 * Set VOICE_LINE_NUMBERS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55514:5432 postgres:16
 *   VOICE_LINE_NUMBERS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55514/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy, where VOICE_LINE_NUMBERS_DB_GATE=required makes a missing URL a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.VOICE_LINE_NUMBERS_TEST_DATABASE_URL
if (!adminUrl && process.env.VOICE_LINE_NUMBERS_DB_GATE === "required") {
  throw new Error("VOICE_LINE_NUMBERS_TEST_DATABASE_URL is required by the voice line numbers database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.VOICE_LINE_NUMBERS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `voice_numbers_${process.pid}`
  const role = `voice_numbers_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  process.env.DATABASE_URL = app.toString()
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-default"
  return { name, role, password, adminScratch: adminScratch.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
}
const sql = (url: string, statement: string) => prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "voice-numbers-schema-")), "schema.prisma")
  writeFileSync(file, stripped)
  return file
}
/** `db push` builds neither the CHECK nor the policy: both come from the migration. */
function migrationGuards(): string {
  const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261105090000_voice_line_numbers/migration.sql"), "utf8")
  const check = /CONSTRAINT "voice_line_numbers_e164_check" CHECK (\(.*\))/.exec(migration)
  if (!check) throw new Error("voice line number CHECK not found in the migration")
  return `ALTER TABLE "voice_line_numbers" ADD CONSTRAINT "voice_line_numbers_e164_check" CHECK ${check[1]};\n` +
    migration.slice(migration.indexOf(`ALTER TABLE "voice_line_numbers" ENABLE ROW LEVEL SECURITY`))
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method, headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Test)" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

describe.skipIf(!scratch)("phone numbers to organizations on a real Postgres", () => {
  let admin!: PrismaClient
  let app!: typeof import("@/lib/prisma").prisma
  let lines!: typeof import("@/lib/voip/line-numbers")
  let route!: typeof import("@/app/api/v1/admin/tenants/[id]/voice-numbers/route")

  beforeAll(async () => {
    sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    sql(scratch!.adminScratch, migrationGuards())
    sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)
    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [
      { id: "org-default", name: "LeadDrive Inc.", slug: "leaddrive" },
      { id: "org-zeytun", name: "Zeytun Pharma", slug: "zeytun" },
      { id: "org-clinic", name: "Clinic", slug: "clinic" },
    ] })
    await admin.user.create({ data: { id: "user-root", organizationId: "org-default", email: "root@leaddrive.test", name: "Root", passwordHash: "-", role: "superadmin" } })
    await admin.channelConfig.create({ data: { id: "voip-zeytun", organizationId: "org-zeytun", channelType: "voip", configName: "Zeytun line", settings: {} } })
    app = (await import("@/lib/prisma")).prisma
    lines = await import("@/lib/voip/line-numbers")
    route = await import("@/app/api/v1/admin/tenants/[id]/voice-numbers/route")
  }, 300_000)

  afterAll(async () => {
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(async () => {
    await admin.voiceLineNumber.deleteMany({})
    await admin.callLog.deleteMany({})
    session.current = { user: { id: "user-root", organizationId: "org-default", role: "superadmin", email: "root@leaddrive.test", name: "Root" } }
  })

  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it("assigns a number written any common way, and refuses it to a second organization", async () => {
    const added = await route.POST(json("POST", "/api/v1/admin/tenants/org-zeytun/voice-numbers",
      { number: "012 555 30 65", label: "Sifarişlər", channelConfigId: "voip-zeytun" }), params("org-zeytun"))
    expect(added.status).toBe(201)
    expect((await added.json()).data.numbers).toMatchObject([{ e164: "+994125553065", label: "Sifarişlər", channelConfigId: "voip-zeytun" }])
    const taken = await route.POST(json("POST", "/api/v1/admin/tenants/org-clinic/voice-numbers", { number: "+994125553065" }), params("org-clinic"))
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: "number_taken", holder: "Zeytun Pharma" })
    // Another organization's channel is not the line's channel.
    const wrongChannel = await route.POST(json("POST", "/api/v1/admin/tenants/org-clinic/voice-numbers",
      { number: "+994125550000", channelConfigId: "voip-zeytun" }), params("org-clinic"))
    expect(wrongChannel.status).toBe(400)
    session.current = { user: { id: "user-root", organizationId: "org-zeytun", role: "admin", email: "a@zeytun.test", name: "A" } }
    expect((await route.POST(json("POST", "/api/v1/admin/tenants/org-zeytun/voice-numbers", { number: "+994125551111" }), params("org-zeytun"))).status).toBe(403)
  })

  it("finds the organization by the number dialled, then by the call, and keeps the default for anything else", async () => {
    await admin.voiceLineNumber.create({ data: { organizationId: "org-zeytun", e164: "+994125553065", channelConfigId: "voip-zeytun" } })
    expect(await lines.voiceOrganizationFor({ callId: "11111111-1111-4111-8111-111111111111", dialled: "994125553065" }))
      .toEqual({ organizationId: "org-zeytun", channelConfigId: "voip-zeytun" })
    // The station's old label instead of a number: the installation default.
    expect(await lines.voiceOrganizationFor({ dialled: "fanum-inbound-browser" })).toEqual({ organizationId: "org-default", channelConfigId: null })
    expect(await lines.voiceOrganizationFor({ dialled: "+994125550000" })).toEqual({ organizationId: "org-default", channelConfigId: null })
    // Once the call exists, it decides — whatever number a later event names.
    await admin.callLog.create({ data: { organizationId: "org-zeytun", provider: "asterisk", providerCallId: "22222222-2222-4222-8222-222222222222",
      direction: "inbound", fromNumber: "+994552223344", toNumber: "+994125553065" } })
    expect(await lines.voiceOrganizationFor({ callId: "22222222-2222-4222-8222-222222222222" })).toEqual({ organizationId: "org-zeytun", channelConfigId: null })
    // One id in two organizations is not trusted to either.
    await admin.callLog.create({ data: { organizationId: "org-clinic", provider: "asterisk", providerCallId: "22222222-2222-4222-8222-222222222222",
      direction: "inbound", fromNumber: "+994552223344", toNumber: "x" } })
    expect(await lines.callOrganization("22222222-2222-4222-8222-222222222222")).toBeNull()
  })

  it("keeps the table to its organization for the application's role, and refuses a malformed number in the database", async () => {
    await admin.voiceLineNumber.create({ data: { organizationId: "org-zeytun", e164: "+994125553065" } })
    const { runWithTenant } = await import("@/lib/rls-context")
    // Another organization's context sees none of it; its own sees its row.
    expect(await runWithTenant("org-clinic", () => app.voiceLineNumber.count())).toBe(0)
    expect(await runWithTenant("org-zeytun", () => app.voiceLineNumber.count())).toBe(1)
    await expect(admin.voiceLineNumber.create({ data: { organizationId: "org-clinic", e164: "0125553065" } })).rejects.toThrow()
  })
})
