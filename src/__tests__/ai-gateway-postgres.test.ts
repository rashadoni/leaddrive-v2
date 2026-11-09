/**
 * The AI gateway (src/lib/ai/gateway) on a real Postgres, connected as an
 * application role without BYPASSRLS, with both new tables built from their
 * migration — so FORCE RLS answers as in production.
 *
 *  - An organization's own key is stored sealed (never the plain key), a
 *    screen gets only its last four characters, and no other organization
 *    can read or write the row.
 *  - Claude gets the organization's key when it has one, the platform's
 *    otherwise — and nothing when the superadmin switched the platform key
 *    off for it ("решаю по каждому клиенту", owner 2026-11-09).
 *  - Every finished call is one `ai_usage` row: feature, agent, tokens,
 *    price with the cache priced in, and whose key paid.
 *  - The daily budget reads that journal and refuses the next call.
 *
 * The one stand-in is Claude itself: `getAnthropicClient` returns a client
 * that records which key it was built with and answers with fixed usage.
 *
 * Set AI_GATEWAY_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 postgres:16
 *   AI_GATEWAY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («AI gateway database gate»), where `AI_GATEWAY_DB_GATE=required`
 * turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.AI_GATEWAY_TEST_DATABASE_URL
if (!adminUrl && process.env.AI_GATEWAY_DB_GATE === "required") {
  throw new Error("AI_GATEWAY_TEST_DATABASE_URL is required by the AI gateway database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.AI_GATEWAY_TEST_DATABASE_URL
  if (!admin) return null
  const name = `ai_gateway_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "ai-gateway-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.ANTHROPIC_API_KEY = "sk-ant-platform-key-for-tests" // gitleaks:allow — not a key
  return { name, role, adminDb: db.toString() }
})

/** Every client the gateway built, with the key it was given. */
const built = vi.hoisted(() => ({ keys: [] as Array<string | undefined> }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: (options?: { apiKey?: string }) => {
    built.keys.push(options?.apiKey)
    return {
      messages: {
        create: async (params: { model: string }) => ({
          model: params.model,
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        }),
      },
    }
  },
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261210090000_ai_provider_gateway/migration.sql")

const ORG = "org-gateway"
const OTHER = "org-gateway-other"
const OFF = "org-gateway-platform-off"
const TENANT_KEY = "sk-ant-org-own-key-for-tests-WXYZ" // gitleaks:allow — not a key

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ai-gateway-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

;(scratch ? describe : describe.skip)("the AI gateway on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let gateway!: typeof import("@/lib/ai/gateway")
  let budget!: typeof import("@/lib/ai/budget")
  let createdDb = false
  let createdRole = false

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'ai-gateway-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    // The two tables as production gets them: from their migration, with RLS.
    // The organizations column is already there from the schema.
    const migration = readFileSync(MIGRATION, "utf8").replace(/^ALTER TABLE "organizations"[^;]*;$/m, "")
    sql(scratch!.adminDb, `DROP TABLE "tenant_ai_credentials"; DROP TABLE "ai_usage";\n${migration}`)
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    gateway = await import("@/lib/ai/gateway")
    budget = await import("@/lib/ai/budget")
    await rls.runWithRlsBypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      await prisma.organization.create({ data: { id: OFF, name: OFF, slug: OFF, aiPlatformKey: false } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  beforeEach(async () => {
    built.keys = []
    gateway.forgetTenantAiAccess()
    await rls.runWithRlsBypass(async () => {
      await prisma.aiUsage.deleteMany({})
      await prisma.tenantAiCredential.deleteMany({})
      await prisma.organization.update({ where: { id: ORG }, data: { settings: {} } })
    })
  })

  const usageRows = (orgId: string) => rls.runWithRlsBypass(() => prisma.aiUsage.findMany({ where: { organizationId: orgId } }))
  /** The journal is written after the call returns; give it its turn. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

  it("keeps both tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await rls.runWithRlsBypass(() => prisma.$queryRaw<Array<{ relname: string; enabled: boolean; forced: boolean }>>`
      SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
       WHERE relname IN ('tenant_ai_credentials', 'ai_usage') ORDER BY relname`)
    expect(tables).toEqual([
      { relname: "ai_usage", enabled: true, forced: true },
      { relname: "tenant_ai_credentials", enabled: true, forced: true },
    ])
  })

  it("stores an organization's key sealed, shows only its hint, and keeps it from every other organization", async () => {
    const saved = await gateway.saveTenantAiCredential({ orgId: ORG, provider: "anthropic", secret: `  ${TENANT_KEY}  `, userId: null })
    expect(saved).toEqual({ keyHint: "…WXYZ", status: "unchecked" })

    const [raw] = await rls.runWithRlsBypass(() => prisma.$queryRaw<Array<{ secret: string }>>`
      SELECT secret FROM tenant_ai_credentials WHERE "organizationId" = ${ORG}`)
    expect(raw.secret).not.toContain(TENANT_KEY)
    expect(raw.secret).toMatch(/^v2:/)

    const listed = await gateway.listTenantAiCredentials(ORG)
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(TENANT_KEY)
    expect(listed[0]).toMatchObject({ provider: "anthropic", keyHint: "…WXYZ" })

    // Another organization sees no row and cannot write one for ORG.
    await rls.runWithTenant(OTHER, async () => {
      expect(await prisma.tenantAiCredential.findMany()).toEqual([])
      await expect(prisma.tenantAiCredential.create({
        data: { organizationId: ORG, provider: "openai", secret: "x", keyHint: "…x" },
      })).rejects.toThrow()
    })
    expect((await gateway.tenantAiAccess(OTHER, "anthropic")).secret).toBeNull()
  })

  it("calls Claude with the organization's own key when it has one, and journals the call as its spend", async () => {
    await gateway.saveTenantAiCredential({ orgId: ORG, provider: "anthropic", secret: TENANT_KEY })
    const client = await gateway.anthropicFor(ORG, "davinci-chat", { agentId: "agent-7" })
    await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 10, messages: [{ role: "user", content: "hi" }] })
    await settle()

    expect(built.keys).toEqual([TENANT_KEY])
    const [row, ...more] = await usageRows(ORG)
    expect(more).toEqual([])
    expect(row).toMatchObject({
      feature: "davinci-chat",
      agentId: "agent-7",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
      keySource: "tenant",
    })
    // $3 in, $15 out per million; cache read 0.1×, 5-minute write 1.25×.
    expect(row.costUsd).toBeCloseTo((100 * 3 + 1000 * 0.3 + 200 * 3.75 + 50 * 15) / 1_000_000, 12)
  })

  it("falls back to the platform key, and refuses where the superadmin switched it off", async () => {
    const client = await gateway.anthropicFor(ORG, "inbox-reply")
    await client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }] })
    await settle()
    expect(built.keys).toEqual([process.env.ANTHROPIC_API_KEY])
    expect((await usageRows(ORG))[0]).toMatchObject({ keySource: "platform", feature: "inbox-reply" })

    await expect(gateway.anthropicFor(OFF, "davinci-chat")).rejects.toMatchObject({ reason: "not_connected" })
    expect(await gateway.anthropicAvailable(OFF)).toBe(false)
    expect(built.keys).toHaveLength(1)

    // With its own key the same organization works again.
    await gateway.saveTenantAiCredential({ orgId: OFF, provider: "anthropic", secret: TENANT_KEY })
    expect(await gateway.anthropicAvailable(OFF)).toBe(true)
  })

  it("counts the journal against the daily budget and refuses the call that would go over it", async () => {
    await rls.runWithRlsBypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: { aiDailyBudgetUsd: 0.01 } } }))
    const checkBudget = () => rls.runWithTenant(ORG, () => budget.checkAiBudget(ORG))
    expect((await checkBudget()).allowed).toBe(true)
    await gateway.recordAiUsage({ orgId: ORG, feature: "social", provider: "anthropic", keySource: "platform", costUsd: 0.02 })
    // Another organization's spend is not this one's.
    await gateway.recordAiUsage({ orgId: OTHER, feature: "social", provider: "anthropic", keySource: "platform", costUsd: 9 })

    const state = await checkBudget()
    expect(state).toMatchObject({ allowed: false, spent: 0.02 })
    await expect(gateway.anthropicFor(ORG, "davinci-chat")).rejects.toMatchObject({ reason: "budget_exceeded" })
    expect(built.keys).toEqual([])
  })
})
