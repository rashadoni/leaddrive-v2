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
 *  - The daily budget reads that journal and refuses the next call — only
 *    for spend on the platform's key: on its own key the organization is
 *    neither counted nor stopped.
 *  - Gemini, OpenAI, Voyage and Google Vision (stage 3) take the same key
 *    rules, and their calls land in the same journal — the voice assistant's
 *    by its billed length, on the key the organization holds when it ends.
 *  - The spend report («Настройки → ИИ и расходы») buckets the journal by
 *    day, week or month in the viewer's time zone, returns every period of
 *    the window (an empty one as zero), names the agent, and shows nothing
 *    of another organization.
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
  process.env.GEMINI_API_KEY = "gemini-platform-key-for-tests,second-key" // gitleaks:allow — not a key
  process.env.OPENAI_API_KEY = "sk-openai-platform-key-for-tests" // gitleaks:allow — not a key
  delete process.env.VOYAGE_API_KEY // no platform Voyage key: the refusal case
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
  it("limits only spend on the platform key: the organization's own key is neither counted nor stopped", async () => {
    await rls.runWithRlsBypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: { aiDailyBudgetUsd: 0.01 } } }))
    const checkBudget = () => rls.runWithTenant(ORG, () => budget.checkAiBudget(ORG))
    await gateway.recordAiUsage({ orgId: ORG, feature: "social", provider: "anthropic", keySource: "tenant", costUsd: 5 })
    expect(await checkBudget()).toMatchObject({ allowed: true, spent: 0 })

    await gateway.recordAiUsage({ orgId: ORG, feature: "social", provider: "anthropic", keySource: "platform", costUsd: 0.02 })
    await expect(gateway.anthropicFor(ORG, "davinci-chat")).rejects.toMatchObject({ reason: "budget_exceeded" })

    // Over the platform's limit, the organization's own key still answers.
    await gateway.saveTenantAiCredential({ orgId: ORG, provider: "anthropic", secret: TENANT_KEY })
    await gateway.anthropicFor(ORG, "davinci-chat")
    expect(built.keys).toEqual([TENANT_KEY])

    await gateway.deleteTenantAiCredential(ORG, "anthropic")
    await expect(gateway.anthropicFor(ORG, "davinci-chat")).rejects.toMatchObject({ reason: "budget_exceeded" })
  })

  it("reports spend by day, week and month in the viewer's zone, every period of the window, and only its own", async () => {
    const agent = await rls.runWithRlsBypass(() => prisma.aiAgentConfig.create({ data: { organizationId: ORG, configName: "Support Pro" } }))
    const localDay = (at: Date, timeZone: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
    const now = new Date()
    // 30 seconds after midnight in Baku today: still yesterday in UTC.
    const bakuToday = localDay(now, "Asia/Baku")
    const bakuMidnight = new Date(`${bakuToday}T00:00:30+04:00`)
    const rows = [
      { at: now, feature: "davinci-chat", agentId: agent.id, keySource: "platform", costUsd: 0.5, model: "claude-haiku-4-5-20251001" },
      { at: bakuMidnight, feature: "davinci-chat", agentId: agent.id, keySource: "platform", costUsd: 0.1, model: "claude-haiku-4-5-20251001" },
      { at: new Date(now.getTime() - 3 * 86_400_000), feature: "social", agentId: null, keySource: "platform", costUsd: 1.25, model: "claude-sonnet-4-6" },
      { at: now, feature: "inbox-reply", agentId: null, keySource: "tenant", costUsd: 0.25, model: "claude-haiku-4-5-20251001" },
      { at: new Date(now.getTime() - 20 * 86_400_000), feature: "social", agentId: null, keySource: "platform", costUsd: 7, model: "claude-sonnet-4-6" },
    ]
    await rls.runWithRlsBypass(async () => {
      for (const r of rows) {
        await prisma.aiUsage.create({ data: {
          organizationId: ORG, feature: r.feature, agentId: r.agentId, provider: "anthropic", model: r.model,
          inputTokens: 1000, outputTokens: 100, cacheReadTokens: 10, keySource: r.keySource, costUsd: r.costUsd, createdAt: r.at,
        } })
      }
      await prisma.aiUsage.create({ data: { organizationId: OTHER, feature: "social", provider: "anthropic", keySource: "platform", costUsd: 9 } })
    })

    for (const timeZone of ["Asia/Baku", "UTC"]) {
      const report = await gateway.aiSpendReport(ORG, { granularity: "day", range: "7d", timeZone })
      expect(report.timeZone).toBe(timeZone)
      // Seven days, today last, each present even when nothing was spent.
      expect(report.periods).toHaveLength(7)
      expect(report.periods.at(-1)!.period).toBe(localDay(now, timeZone))
      const expected = new Map<string, number>()
      for (const r of rows.slice(0, 4)) expected.set(localDay(r.at, timeZone), (expected.get(localDay(r.at, timeZone)) ?? 0) + r.costUsd)
      for (const p of report.periods) expect(p.costUsd).toBeCloseTo(expected.get(p.period) ?? 0, 9)
      expect(report.totals).toEqual({ calls: 4, costUsd: 2.1 })
    }

    const report = await gateway.aiSpendReport(ORG, { granularity: "day", range: "7d", timeZone: "Asia/Baku" })
    expect(report.rows).toEqual([
      { feature: "social", agentId: null, agentName: null, provider: "anthropic", model: "claude-sonnet-4-6", keySource: "platform", calls: 1, inputTokens: 1010, outputTokens: 100, costUsd: 1.25 },
      { feature: "davinci-chat", agentId: agent.id, agentName: "Support Pro", provider: "anthropic", model: "claude-haiku-4-5-20251001", keySource: "platform", calls: 2, inputTokens: 2020, outputTokens: 200, costUsd: 0.6 },
      { feature: "inbox-reply", agentId: null, agentName: null, provider: "anthropic", model: "claude-haiku-4-5-20251001", keySource: "tenant", calls: 1, inputTokens: 1010, outputTokens: 100, costUsd: 0.25 },
    ])
    // Today's limit counts the platform key only, by the UTC day.
    const utcToday = rows.filter((r) => r.keySource === "platform" && localDay(r.at, "UTC") === localDay(now, "UTC")).reduce((s, r) => s + r.costUsd, 0)
    expect(report.today.spent).toBeCloseTo(utcToday, 9)

    // Weeks start on Monday and add up to the window's total; months likewise.
    const weeks = await gateway.aiSpendReport(ORG, { granularity: "week", range: "30d", timeZone: "Asia/Baku" })
    for (const p of weeks.periods) expect(new Date(`${p.period}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(weeks.periods.reduce((s, p) => s + p.costUsd, 0)).toBeCloseTo(weeks.totals.costUsd, 9)
    expect(weeks.totals.costUsd).toBeCloseTo(9.1, 9)
    const months = await gateway.aiSpendReport(ORG, { granularity: "month", range: "12m", timeZone: "Asia/Baku" })
    expect(months.periods).toHaveLength(12)
    for (const p of months.periods) expect(p.period.endsWith("-01")).toBe(true)
    expect(months.totals.costUsd).toBeCloseTo(9.1, 9)

    // A zone the runtime does not know reads as UTC rather than failing.
    expect((await gateway.aiSpendReport(ORG, { granularity: "day", range: "7d", timeZone: "Mars/Olympus" })).timeZone).toBe("UTC")
  })
  it("gives Gemini, OpenAI, Voyage and Vision the same key rules and the same journal", async () => {
    // Platform key (the first of Gemini's comma list), journaled as the platform's.
    const gemini = await gateway.aiKeyFor(ORG, "gemini", "phone-line")
    expect(gemini).toMatchObject({ apiKey: "gemini-platform-key-for-tests", keySource: "platform" })
    gemini.journal({ model: "gemini-3.8-flash", inputTokens: 1000, outputTokens: 200 })

    // The organization's own OpenAI key wins over the platform's.
    await gateway.saveTenantAiCredential({ orgId: ORG, provider: "openai", secret: "sk-org-own-openai-key-0001" })
    const openai = await gateway.aiKeyFor(ORG, "openai", "call-transcription")
    expect(openai).toMatchObject({ apiKey: "sk-org-own-openai-key-0001", keySource: "tenant" })
    openai.journal({ model: "whisper-1", costUsd: 0.009 })

    // No platform Voyage key on this installation: refused, not a crash.
    expect(await gateway.aiKeyOrRefusal(ORG, "voyage", "embeddings")).toMatchObject({ reason: "not_connected" })
    // The superadmin switched the platform key off: only an own key opens a provider.
    expect(await gateway.aiProviderAvailable(OFF, "gemini")).toBe(false)
    await gateway.saveTenantAiCredential({ orgId: OFF, provider: "google_vision", secret: "AIza-org-own-vision-key-01" })
    expect(await gateway.aiKeyFor(OFF, "google_vision", "social")).toMatchObject({ keySource: "tenant" })
    await settle()

    const rows = (await usageRows(ORG)).map(({ feature, provider, model, keySource, inputTokens, outputTokens, costUsd }) =>
      ({ feature, provider, model, keySource, inputTokens, outputTokens, costUsd }))
    expect(rows).toEqual(expect.arrayContaining([
      // $0.75 in, $3.75 out per million.
      { feature: "phone-line", provider: "gemini", model: "gemini-3.8-flash", keySource: "platform", inputTokens: 1000, outputTokens: 200, costUsd: expect.closeTo(0.0015, 12) },
      { feature: "call-transcription", provider: "openai", model: "whisper-1", keySource: "tenant", inputTokens: 0, outputTokens: 0, costUsd: 0.009 },
    ]))
    expect(rows).toHaveLength(2)
  })

  it("journals a closed voice session by its billed length, on the key the organization holds", async () => {
    const voiceBudget = await import("@/lib/ai/voice/budget")
    const started = new Date()
    await rls.runWithTenant(ORG, () => voiceBudget.settleVoiceSeconds(ORG, "user-1", 300, 120, started))
    await gateway.saveTenantAiCredential({ orgId: ORG, provider: "gemini", secret: "org-own-gemini-key-000001" })
    await rls.runWithTenant(ORG, () => voiceBudget.settleVoiceSeconds(ORG, "user-1", 300, 60, started))
    // A session that never connected costs nothing and writes nothing.
    await rls.runWithTenant(ORG, () => voiceBudget.settleVoiceSeconds(ORG, "user-1", 300, 0, started))

    const rows = (await usageRows(ORG)).map(({ feature, provider, keySource, costUsd }) => ({ feature, provider, keySource, costUsd }))
    expect(rows).toEqual(expect.arrayContaining([
      { feature: "voice-assistant", provider: "gemini", keySource: "platform", costUsd: expect.closeTo(0.045, 12) },
      { feature: "voice-assistant", provider: "gemini", keySource: "tenant", costUsd: expect.closeTo(0.0225, 12) },
    ]))
    expect(rows).toHaveLength(2)
  })
  it("prices a voice session by Google's token count when the console sends it, never below its incoming audio", async () => {
    const voiceBudget = await import("@/lib/ai/voice/budget")
    const started = new Date()
    // Two turns of a real conversation: the context billed twice, text and audio apart.
    const usage = { textIn: 18_000, audioIn: 1_200, textOut: 40, audioOut: 900, turns: 2 }
    await rls.runWithTenant(ORG, () => voiceBudget.settleVoiceSeconds(ORG, "user-1", 300, 60, started, usage))
    // A console that reports almost nothing still pays a minute of incoming audio.
    const tiny = { textIn: 1, audioIn: 0, textOut: 0, audioOut: 0, turns: 1 }
    await rls.runWithTenant(ORG, () => voiceBudget.settleVoiceSeconds(ORG, "user-1", 300, 60, started, tiny))

    const rows = (await usageRows(ORG))
      .sort((a, b) => b.costUsd - a.costUsd)
      .map(({ feature, model, inputTokens, outputTokens, costUsd }) => ({ feature, model, inputTokens, outputTokens, costUsd }))
    expect(rows).toEqual([
      { feature: "voice-assistant", model: "gemini-live", inputTokens: 19_200, outputTokens: 940,
        costUsd: expect.closeTo((18_000 * 0.75 + 1_200 * 3 + 40 * 4.5 + 900 * 12) / 1e6, 12) },
      { feature: "voice-assistant", model: "gemini-live", inputTokens: 1, outputTokens: 0, costUsd: expect.closeTo(0.0045, 12) },
    ])
  })
})
