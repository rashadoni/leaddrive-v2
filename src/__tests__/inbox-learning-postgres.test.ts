/**
 * Inbox AI training (lib/inbox/learning) on a real Postgres, connected as an application role
 * without BYPASSRLS, with both tables built from their migration — so FORCE RLS answers as in
 * production. The one stand-in is Claude: it answers by which of the four prompts it was given.
 *
 *  - A run reads the people's answers on a channel in «Обучение», in order: the first question is
 *    answered silently by the AI and compared, the next is skipped (owner: «через один»), and so on.
 *  - Nothing reaches the customer: no message is written, no AI chat session is opened.
 *  - A quiet conversation is read for knowledge: the address is usable at once, the price waits for
 *    «Подтвердить» and stays out of the AI's facts until a person confirms it.
 *  - Another organization sees none of it.
 *
 * Set INBOX_LEARNING_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   INBOX_LEARNING_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Inbox AI
 * training database gate»), where `INBOX_LEARNING_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.INBOX_LEARNING_TEST_DATABASE_URL
if (!adminUrl && process.env.INBOX_LEARNING_DB_GATE === "required") {
  throw new Error("INBOX_LEARNING_TEST_DATABASE_URL is required by the inbox AI training database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.INBOX_LEARNING_TEST_DATABASE_URL
  if (!admin) return null
  const name = `inbox_learning_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "inbox-learning-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.ANTHROPIC_API_KEY = "sk-ant-platform-key-for-tests" // gitleaks:allow — not a key
  delete process.env.VOYAGE_API_KEY
  return { name, role, adminDb: db.toString() }
})

/** Claude, by prompt: the live reply, the comparison, the knowledge, the character. */
const claude = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { model: string; system?: string; messages: Array<{ content: string }> }) => {
        const system = String(params.system ?? "")
        const user = String(params.messages.at(-1)?.content ?? "")
        let text: string
        if (system.startsWith("Ты сравниваешь")) {
          claude.calls.push("compare")
          const question = user.split("ОТВЕТ СОТРУДНИКА")[0]
          text = question.includes("Маникюр")
            ? '{"verdict":"different","reason":"no_knowledge","topic":"Цена маникюра"}'
            : '{"verdict":"same","reason":null,"topic":"Часы работы"}'
        } else if (system.startsWith("Ты читаешь переписку")) {
          claude.calls.push("extract")
          text = JSON.stringify({ knowledge: [
            { type: "price", title: "Маникюр с гель-лаком", body: "25 ₼, снятие старого покрытия входит", same_as: null, message: 2 },
            { type: "place", title: "Адрес", body: "ул. Низами 54, 2 этаж", same_as: null, message: 4 },
            { type: "qa", title: "Запись", body: "Записала вас, [PERSON_1], на 16:30", same_as: null, message: 6 },
          ] })
        } else if (system.startsWith("Перед тобой ответы")) {
          claude.calls.push("character")
          text = '{"tone":"Тёплый, на «вы»","address":"По имени","phrases":["Будем рады вас видеть!"],"avoid":null}'
        } else {
          claude.calls.push("reply")
          // A made-up price for the price question — the price rule must keep it from the customer.
          text = user.includes("Маникюр") ? "Здравствуйте! Маникюр стоит 20 ₼." : "Мы работаем каждый день до 21:00."
        }
        return { model: params.model, content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 50 } }
      },
    },
  }),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261219090000_inbox_ai_training/migration.sql")
const MIGRATION_SKIP = path.join(ROOT, "prisma/migrations/20261219100000_inbox_ai_training_skip/migration.sql")
const ORG = "org-learning"
const OTHER = "org-learning-other"
const CHANNEL = "cfg-ig-learning"
const CONVO = "conv-aysel"
// Now, to the minute: rows the run writes carry the wall clock, the conversation lies hours before it.
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const min = (m: number) => new Date(NOW.getTime() - (240 - m) * 60_000)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "inbox-learning-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

;(scratch ? describe : describe.skip)("inbox AI training on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let learning!: typeof import("@/lib/inbox/learning/run")
  let blocks!: typeof import("@/lib/inbox/learning/prompt-blocks")
  let service!: typeof import("@/lib/inbox/learning/service")
  let createdDb = false
  let createdRole = false

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'inbox-learning-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    // Both tables as production gets them: from their migration, with RLS.
    sql(scratch!.adminDb, `DROP TABLE "inbox_learning_samples"; DROP TABLE "inbox_learned_items";\n${readFileSync(MIGRATION, "utf8")}\n${readFileSync(MIGRATION_SKIP, "utf8")}`)
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    learning = await import("@/lib/inbox/learning/run")
    blocks = await import("@/lib/inbox/learning/prompt-blocks")
    service = await import("@/lib/inbox/learning/service")

    await rls.runWithRlsBypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      await prisma.channelConfig.create({
        data: {
          id: CHANNEL, organizationId: ORG, channelType: "instagram", configName: "gozellik.studio",
          settings: { replyMode: "learning", learningStartedAt: min(0).toISOString(), username: "gozellik.studio" },
        },
      })
      await prisma.socialConversation.create({
        data: { id: CONVO, organizationId: ORG, platform: "instagram", externalId: "ig-aysel", contactName: "Aysel M.", channelConfigId: CHANNEL, lastMessageAt: min(20) },
      })
      const person = { authorType: "operator", authorName: "Leyla" }
      const rows: Array<[string, "inbound" | "outbound", string, number, Record<string, unknown>]> = [
        ["m1", "inbound", "Здравствуйте! Маникюр с гель-лаком сколько стоит?", 1, {}],
        ["m2", "outbound", "Айсель, здравствуйте! 25 ₼, снятие старого покрытия входит 🌸", 2, person],
        ["m3", "inbound", "А где вы находитесь?", 3, {}],
        ["m4", "outbound", "ул. Низами 54, 2 этаж", 4, { source: "business_app" }],
        ["m5", "inbound", "Вы до скольки работаете?", 5, {}],
        ["m6", "outbound", "Каждый день до 21:00", 6, person],
        ["m7", "outbound", "Ждём вас!", 7, { autoReply: true, authorType: "ai" }],
        ["m8", "inbound", "Спасибо", 8, {}],
        ["m9", "outbound", "Будем рады вас видеть!", 9, person],
      ]
      for (const [id, direction, body, minute, metadata] of rows) {
        await prisma.channelMessage.create({
          data: {
            id, organizationId: ORG, channelConfigId: CHANNEL, conversationId: CONVO, direction, channelType: "instagram",
            from: direction === "inbound" ? "ig-aysel" : "page", to: direction === "inbound" ? "page" : "ig-aysel", body, metadata, createdAt: min(minute),
          },
        })
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  // Typed wrappers: the RLS helpers return Promise<Awaited<T>>, which loses Prisma's row types here.
  const inOrg = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithTenant(ORG, fn) as Promise<T>
  const bypass = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithRlsBypass(fn) as Promise<T>

  it("keeps both tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; enabled: boolean; forced: boolean }>>`
      SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
       WHERE relname IN ('inbox_learned_items', 'inbox_learning_samples') ORDER BY relname`)
    expect(tables).toEqual([
      { relname: "inbox_learned_items", enabled: true, forced: true },
      { relname: "inbox_learning_samples", enabled: true, forced: true },
    ])
  })

  it("reads the people's answers in order, tries every second question, and sends nothing", async () => {
    const before = await bypass(() => prisma.channelMessage.count({ where: { organizationId: ORG } }))
    const summary = await learning.runInboxLearning({ now: NOW })
    expect(summary).toMatchObject({ channels: 1, drafts: 2, extracted: 1, character: 1, stopped: [] })

    const samples = await inOrg(() => prisma.inboxLearningSample.findMany({ orderBy: { createdAt: "asc" }, select: { answerMessageId: true, verdict: true, topic: true, reason: true, draftLogId: true } }))
    expect(samples.map((s) => [s.answerMessageId, s.verdict])).toEqual([
      ["m2", "different"], // tried: the AI named 20 ₼ — the price rule held it back, and it did not know 25 ₼
      ["m4", "skipped"], // «через один»
      ["m6", "same"], // tried
      ["m9", "skipped"],
    ])
    expect(samples[0]).toMatchObject({ topic: "Цена маникюра", reason: "no_knowledge" })
    // the bot's «Ждём вас!» is not an answer of a person
    expect(samples.some((s) => s.answerMessageId === "m7")).toBe(false)

    // Nothing reached the customer, and the AI kept no chat session of its own.
    expect(await bypass(() => prisma.channelMessage.count({ where: { organizationId: ORG } }))).toBe(before)
    expect(await bypass(() => prisma.aiChatSession.count({ where: { organizationId: ORG } }))).toBe(0)
    expect(await bypass(() => prisma.aiChatMessage.count())).toBe(0)
    // Each silent draft is logged as training, not as a reply, and its text is kept there.
    const logs = await bypass(() => prisma.aiInteractionLog.findMany({ where: { organizationId: ORG }, select: { id: true, agentType: true, aiResponse: true } }))
    expect(logs.map((l) => l.agentType)).toEqual(["inbox_learning", "inbox_learning"])
    expect(logs.find((l) => l.id === samples[0].draftLogId)?.aiResponse).not.toContain("20 ₼")

    // A second run finds nothing new and pays for nothing.
    claude.calls = []
    const again = await learning.runInboxLearning({ now: NOW })
    expect(again).toMatchObject({ samples: 0, drafts: 0, extracted: 0 })
    expect(claude.calls).toEqual([])
  })

  it("says how far training has got — waiting, then everything read — and stamps each pass on the channel", async () => {
    const before = await inOrg(() => service.learningProgress(ORG, { id: CHANNEL, settings: { replyMode: "learning", learningStartedAt: min(0).toISOString() } }, 0))
    expect(before.state).toBe("waiting_first_run")

    const channel = await bypass(() => prisma.channelConfig.findUniqueOrThrow({ where: { id: CHANNEL } }))
    const settings = channel.settings as Record<string, unknown>
    // The pass left its own stamp and nothing else changed: the mode is still the admin's.
    expect(settings).toMatchObject({ replyMode: "learning", username: "gozellik.studio", learningRun: { at: NOW.toISOString(), stopped: null } })

    const detail = await inOrg(() => service.channelLearningDetail(ORG, CHANNEL))
    expect(detail!.progress).toMatchObject({
      answersTotal: 4, // m2, m4, m6, m9 — not the bot's m7
      answersRead: 4,
      conversationsTotal: 1,
      conversationsRead: 1,
      compared: 2,
      minQuestions: 30,
      lastRunAt: NOW.toISOString(),
      stopped: null,
      state: "listening",
    })
  })

  it("keeps an unconfirmed price out of the AI's facts until a person confirms it", async () => {
    const items = await inOrg(() => prisma.inboxLearnedItem.findMany({ where: { kind: "knowledge" }, orderBy: { title: "asc" } }))
    expect(items.map((i) => [i.title, i.status, i.sourceConversationId])).toEqual([
      ["Адрес", "active", CONVO],
      ["Маникюр с гель-лаком", "pending", CONVO],
    ]) // the booking for this customer was not knowledge
    const address = items.find((i) => i.title === "Адрес")!
    expect(address.sourceMessageId).toBe("m4")

    const first = await inOrg(() => blocks.learnedPromptBlocks({ organizationId: ORG, conversationId: CONVO }))
    expect(first.knowledge).toContain("Адрес: ул. Низами 54")
    expect(first.knowledge).not.toContain("25 ₼")

    const price = items.find((i) => i.status === "pending")!
    const approved = await inOrg(() => service.changeItem({ organizationId: ORG, channelConfigId: CHANNEL, itemId: price.id, userId: null, change: { action: "approve" } }))
    expect(approved).toMatchObject({ ok: true, item: { status: "active" } })
    const after = await inOrg(() => blocks.learnedPromptBlocks({ organizationId: ORG, channelConfigId: CHANNEL }))
    expect(after.knowledge).toContain("Маникюр с гель-лаком: 25 ₼")
  })

  it("lets a person edit, remove and bring back — and learning does not resurrect a removed row", async () => {
    const address = await inOrg(() => prisma.inboxLearnedItem.findFirstOrThrow({ where: { title: "Адрес" } }))
    const removed = await inOrg(() => service.changeItem({ organizationId: ORG, channelConfigId: CHANNEL, itemId: address.id, userId: null, change: { action: "remove" } }))
    expect(removed.ok).toBe(true)
    expect((await inOrg(() => blocks.learnedPromptBlocks({ organizationId: ORG, channelConfigId: CHANNEL }))).knowledge).not.toContain("Низами")

    // The same conversation read again does not bring it back.
    await bypass(() => prisma.inboxLearningSample.updateMany({ where: { organizationId: ORG }, data: { extractedAt: null } }))
    await learning.runInboxLearning({ now: NOW })
    const rows = await inOrg(() => prisma.inboxLearnedItem.findMany({ where: { title: "Адрес" } }))
    expect(rows).toHaveLength(1)
    expect(rows[0].removedAt).not.toBeNull()

    await inOrg(() => service.changeItem({ organizationId: ORG, channelConfigId: CHANNEL, itemId: address.id, userId: null, change: { action: "restore" } }))
    const edited = await inOrg(() => service.changeItem({ organizationId: ORG, channelConfigId: CHANNEL, itemId: address.id, userId: null, change: { action: "edit", body: "ул. Низами 54, 2 этаж, вход со двора" } }))
    expect(edited).toMatchObject({ ok: true, item: { body: "ул. Низами 54, 2 этаж, вход со двора", edited: true } })
  })

  it("shows the readiness and the thread marks from the same rows", async () => {
    const list = await inOrg(() => service.listLearningChannels(ORG))
    expect(list).toEqual([expect.objectContaining({ id: CHANNEL, name: "@gozellik.studio", mode: "learning", readiness: expect.objectContaining({ compared: 2, percent: null }) })])

    const detail = await inOrg(() => service.channelLearningDetail(ORG, CHANNEL))
    expect(detail!.differences).toEqual([expect.objectContaining({
      question: "Здравствуйте! Маникюр с гель-лаком сколько стоит?",
      personAnswer: "Айсель, здравствуйте! 25 ₼, снятие старого покрытия входит 🌸",
      contactName: "Aysel M.",
    })])

    const marks = await inOrg(() => service.conversationLearning(ORG, CONVO))
    expect(marks).toMatchObject({ mode: "learning", answers: { m2: { verdict: "different" }, m6: { verdict: "same" } } })

    // «Пропустить — не учить»: gone from the list and from the figure, and the thread no longer judges it.
    const sample = detail!.differences[0]
    const skipped = await inOrg(() => service.changeSample({ organizationId: ORG, channelConfigId: CHANNEL, sampleId: sample.id, userId: null, change: { action: "dismiss" } }))
    expect(skipped).toEqual({ ok: true, item: undefined })
    const afterSkip = await inOrg(() => service.channelLearningDetail(ORG, CHANNEL))
    expect(afterSkip!.differences).toEqual([])
    expect(afterSkip!.readiness).toMatchObject({ compared: 1, same: 1, different: 0 })
    expect(await inOrg(() => prisma.inboxLearnedItem.count({ where: { sourceMessageId: "m2", kind: "knowledge", title: "Цена маникюра" } }))).toBe(0)
    expect((await inOrg(() => service.conversationLearning(ORG, CONVO)))!.answers.m2).toBeUndefined()

    // A decided answer is not decided again; «Ответ ИИ тоже подходит» on a fresh one counts it as the same.
    expect(await inOrg(() => service.changeSample({ organizationId: ORG, channelConfigId: CHANNEL, sampleId: sample.id, userId: null, change: { action: "accept" } })))
      .toEqual({ ok: false, status: 409, error: "already_resolved" })
    await bypass(() => prisma.inboxLearningSample.update({ where: { id: sample.id }, data: { resolution: null } }))
    await inOrg(() => service.changeSample({ organizationId: ORG, channelConfigId: CHANNEL, sampleId: sample.id, userId: null, change: { action: "accept" } }))
    const marksAfter = await inOrg(() => service.conversationLearning(ORG, CONVO))
    expect(marksAfter!.answers.m2.verdict).toBe("same")
  })

  it("shows another organization nothing and lets it write nothing", async () => {
    await rls.runWithTenant(OTHER, async () => {
      expect(await prisma.inboxLearnedItem.findMany()).toEqual([])
      expect(await prisma.inboxLearningSample.findMany()).toEqual([])
      await expect(prisma.inboxLearnedItem.create({
        data: { organizationId: ORG, channelConfigId: CHANNEL, kind: "knowledge", type: "price", title: "x", body: "1 ₼", status: "active" },
      })).rejects.toThrow()
      expect(await service.channelLearningDetail(OTHER, CHANNEL)).toBeNull()
      expect((await blocks.learnedPromptBlocks({ organizationId: OTHER, channelConfigId: CHANNEL })).knowledge).toBe("")
    })
  })

  it("keeps a person's price and the character in the prompt however much was learned after them", async () => {
    const FULL = "cfg-ig-full"
    await bypass(() => prisma.channelConfig.create({
      data: { id: FULL, organizationId: ORG, channelType: "instagram", configName: "full.studio", settings: { replyMode: "learning" } },
    }))
    const added = await inOrg(() => service.createItem({ organizationId: ORG, channelConfigId: FULL, userId: null, type: "price", title: "Новый прайс", body: "Маникюр 40 ₼" }))
    expect(added.ok).toBe(true)

    const channel = { organizationId: ORG, channelConfigId: FULL }
    const older = new Date(Date.now() - 3_600_000)
    const later = new Date(Date.now() + 60_000)
    await inOrg(() => prisma.inboxLearnedItem.create({
      data: { ...channel, kind: "trait", type: "tone", title: "Тон", body: "Тёплый, на «вы»", status: "active", lastSeenAt: older },
    }))
    // Learned from a conversation long ago, then confirmed by a person with «Подтвердить».
    const waiting = await inOrg(() => prisma.inboxLearnedItem.create({
      data: { ...channel, kind: "knowledge", type: "price", title: "Педикюр", body: "30 ₼", status: "pending", lastSeenAt: older },
    }))
    expect(await inOrg(() => service.changeItem({ organizationId: ORG, channelConfigId: FULL, itemId: waiting.id, userId: null, change: { action: "approve" } })))
      .toMatchObject({ ok: true, item: { status: "active" } })
    // More rows than one read takes and more text than the block holds, all seen after the person's entry.
    await inOrg(() => prisma.inboxLearnedItem.createMany({
      data: [
        ...Array.from({ length: 450 }, (_, i) => ({
          ...channel, kind: "knowledge", type: "qa", title: `Вопрос ${i}`, body: "ответ ".repeat(20), status: "active", lastSeenAt: later,
        })),
        { ...channel, kind: "knowledge", type: "price", title: "Ждёт", body: "77 ₼", status: "pending", lastSeenAt: later },
        { ...channel, kind: "knowledge", type: "price", title: "Спор", body: "88 ₼", status: "conflict", lastSeenAt: later },
      ],
    }))

    const { knowledge, character } = await inOrg(() => blocks.learnedPromptBlocks({ organizationId: ORG, channelConfigId: FULL }))
    expect(knowledge.split("\n").slice(1, 3)).toEqual(["- Новый прайс: Маникюр 40 ₼", "- Педикюр: 30 ₼"])
    expect(knowledge).toContain("- Вопрос ")
    expect(knowledge).not.toContain("77 ₼")
    expect(knowledge).not.toContain("88 ₼")
    expect(character).toContain("Тёплый, на «вы»")

    // People start naming another price: the confirmed one leaves the facts until a person settles it.
    await inOrg(() => prisma.inboxLearnedItem.updateMany({ where: { id: waiting.id, organizationId: ORG }, data: { status: "conflict" } }))
    const disputed = await inOrg(() => blocks.learnedPromptBlocks({ organizationId: ORG, channelConfigId: FULL }))
    expect(disputed.knowledge).not.toContain("- Педикюр: 30 ₼")
  })
})
