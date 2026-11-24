/**
 * «Черновики в Telegram» against a real Postgres (lib/inbox/ai-draft-telegram, owner 2026-11-24):
 * an AI draft on an Instagram channel with the switch on reaches the linked admins' Telegram as a card
 * with buttons; «Göndər» sends it to the customer through the inbox's own path — once, however many
 * presses; «Düzəlt» sends the employee's own text and teaches it; «Özüm yazacam» sends nothing; a
 * reply from the CRM turns the cards into «artıq cavab verilib»; another organization's employee
 * cannot press our card; a draft with a blank cannot go as it is.
 *
 * Stood in: Telegram's Bot API and Meta's Graph API (`fetch`). Everything on our side is real — the
 * bot's webhook route, the draft store, sendConversationReply, the training tables.
 *
 * Runs with TELEGRAM_STAFF_TEST_DATABASE_URL (the same gate as telegram-staff-postgres.test.ts).
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.TELEGRAM_STAFF_TEST_DATABASE_URL
if (!adminUrl && process.env.TELEGRAM_STAFF_DB_GATE === "required") {
  throw new Error("TELEGRAM_STAFF_TEST_DATABASE_URL is required by the Telegram staff bot database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.TELEGRAM_STAFF_TEST_DATABASE_URL
  if (!admin) return null
  const name = `ai_draft_tg_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

vi.mock("@/lib/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

/* ─── Telegram and Meta, stood in ─── */
const TOKEN = "888000111:AAH-the-employees-bot-of-leaddrive-xx"
const OTHER_TOKEN = "888000222:AAH-the-employees-bot-of-someone-else"
const net = vi.hoisted(() => ({
  tg: [] as Array<{ token: string; method: string; body: Record<string, unknown> }>,
  meta: [] as Array<{ recipient: unknown; text: string }>,
  secrets: {} as Record<string, string>,
}))

async function fakeNetwork(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  const body = JSON.parse(String(init?.body ?? "{}"))
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  if (url.hostname === "api.telegram.org") {
    const [, botPart, method] = url.pathname.split("/")
    const token = botPart.replace(/^bot/, "")
    net.tg.push({ token, method, body })
    if (method === "getMe") return ok({ id: Number(token.split(":")[0]), is_bot: true, username: token === TOKEN ? "leaddrive_staff_bot" : "other_staff_bot" })
    if (method === "setWebhook") {
      net.secrets[token] = body.secret_token
      return ok(true)
    }
    return ok(method === "sendMessage" ? { message_id: 1000 + net.tg.length } : true)
  }
  if ((url.hostname === "graph.facebook.com" || url.hostname === "graph.instagram.com") && url.pathname.endsWith("/me/messages")) {
    net.meta.push({ recipient: body.recipient, text: body.message?.text })
    return new Response(JSON.stringify({ recipient_id: "ig-cust-1", message_id: `m_${net.meta.length}` }), { status: 200 })
  }
  throw new Error(`unexpected fetch ${url.href}`)
}

const ROOT = process.cwd()
const ORG = "org-ld"
const OTHER_ORG = "org-ld-other"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "ai-draft-tg-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** `db push` builds no CHECKs: the card's kind and statuses must pass the ones the migration sets. */
const cardMigrationSql = () => readFileSync(path.join(ROOT, "prisma/migrations/20261227090000_telegram_staff_ai_draft_cards/migration.sql"), "utf8")

const request = (url: string, body: unknown, headers: Record<string, string>) => new NextRequest(`http://localhost:3000${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
})

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("AI drafts in the employees' Telegram, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let webhook!: typeof import("@/app/api/v1/webhooks/telegram-staff/[botId]/route").POST
  let saveDraft!: typeof import("@/lib/inbox/ai-draft").saveConversationAiDraft
  let sendReply!: typeof import("@/lib/inbox/send-conversation-reply").sendConversationReply
  let channelId = ""
  let updateId = 500
  let draftSeq = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, cardMigrationSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    tenant = (await import("@/lib/rls-context")).runWithTenant
    webhook = (await import("@/app/api/v1/webhooks/telegram-staff/[botId]/route")).POST
    saveDraft = (await import("@/lib/inbox/ai-draft")).saveConversationAiDraft
    sendReply = (await import("@/lib/inbox/send-conversation-reply")).sendConversationReply
    const { connectStaffBot } = await import("@/lib/telegram-staff/bot-config")

    vi.stubGlobal("fetch", vi.fn(fakeNetwork))
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "ld-az"], [OTHER_ORG, "ld-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, ai: true, inbox: true, omnichannel: true, settings: true } } })
      }
      await prisma.user.createMany({
        data: [
          { id: "u-leyla", organizationId: ORG, email: "leyla@ld.test", name: "Leyla", passwordHash: "-", role: "admin" },
          { id: "u-kamran", organizationId: ORG, email: "kamran@ld.test", name: "Kamran", passwordHash: "-", role: "admin" },
          { id: "u-sup", organizationId: ORG, email: "sup@ld.test", name: "Sup", passwordHash: "-", role: "support" },
          { id: "u-other", organizationId: OTHER_ORG, email: "other@ld.test", name: "Other", passwordHash: "-", role: "admin" },
        ],
      })
      const channel = await prisma.channelConfig.create({
        data: {
          organizationId: ORG, channelType: "instagram", configName: "@leaddrive.az", apiKey: "IG-PAGE-TOKEN", isActive: true,
          settings: { replyMode: "ai", draftMode: true, telegramDrafts: true },
        },
      })
      channelId = channel.id
    })
    for (const [org, token, user] of [[ORG, TOKEN, "u-leyla"], [OTHER_ORG, OTHER_TOKEN, "u-other"]] as const) {
      const result = await tenant(org, () => connectStaffBot(org, user, token))
      expect(result).toEqual({ ok: true })
    }
    await bypass(async () => {
      const bots = await prisma.telegramStaffBot.findMany({ select: { id: true, organizationId: true } })
      const botOf = (org: string) => bots.find((b: { organizationId: string }) => b.organizationId === org)!.id
      await prisma.telegramStaffLink.createMany({
        data: [
          { organizationId: ORG, botId: botOf(ORG), userId: "u-leyla", telegramUserId: "6001", chatId: "6001" },
          { organizationId: ORG, botId: botOf(ORG), userId: "u-kamran", telegramUserId: "6002", chatId: "6002" },
          { organizationId: ORG, botId: botOf(ORG), userId: "u-sup", telegramUserId: "6003", chatId: "6003" },
          { organizationId: OTHER_ORG, botId: botOf(OTHER_ORG), userId: "u-other", telegramUserId: "7001", chatId: "7001" },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    net.tg = []
    net.meta = []
    vi.stubGlobal("fetch", vi.fn(fakeNetwork))
  })

  const cards = () => net.tg.filter((c) => c.method === "sendMessage" && JSON.stringify(c.body.reply_markup ?? "").includes("\"d:"))
  const edits = (chatId: string) => net.tg.filter((c) => c.method === "editMessageText" && c.body.chat_id === chatId).map((c) => String(c.body.text))
  const callbacks = (chatId: string) => (cards().find((c) => c.body.chat_id === chatId)!.body.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard[0].map((b) => b.callback_data!)

  async function botRow(org: string) {
    return bypass(() => prisma.telegramStaffBot.findFirst({ where: { organizationId: org } }))
  }
  async function deliver(org: string, update: Record<string, unknown>) {
    const row = await botRow(org)
    const token = org === ORG ? TOKEN : OTHER_TOKEN
    return webhook(
      request(`/api/v1/webhooks/telegram-staff/${row!.id}`, { update_id: ++updateId, ...update }, { "x-telegram-bot-api-secret-token": net.secrets[token] }),
      { params: Promise.resolve({ botId: row!.id }) },
    )
  }
  const press = (fromId: number, data: string, org = ORG) =>
    deliver(org, { callback_query: { id: `cb${fromId}-${updateId}`, data, from: { id: fromId }, message: { message_id: 77, chat: { id: fromId, type: "private" } } } })
  const write = (fromId: number, text: string) =>
    deliver(ORG, { message: { message_id: 5, text, chat: { id: fromId, type: "private" }, from: { id: fromId } } })

  /** A new customer conversation with one inbound message and a pending AI draft. */
  async function conversationWithDraft(draftText: string, customerText = "Salam, CRM neçəyədir? 5 nəfərlik komanda üçün") {
    const n = ++draftSeq
    const conv = await bypass(async () => {
      const row = await prisma.socialConversation.create({
        data: { organizationId: ORG, channelConfigId: channelId, platform: "instagram", externalId: `ig-cust-${n}`, contactName: "Aysel Məmmədova", status: "open" },
      })
      await prisma.channelMessage.create({
        data: { organizationId: ORG, channelConfigId: channelId, conversationId: row.id, direction: "inbound", channelType: "instagram", from: `ig-cust-${n}`, to: "page", body: customerText, status: "received", createdAt: new Date(Date.now() - 60_000) },
      })
      return row
    })
    await tenant(ORG, () => saveDraft({
      organizationId: ORG,
      conversationId: conv.id,
      draft: { text: draftText, reason: "draft_mode", channel: "instagram", to: `ig-cust-${n}`, createdAt: new Date().toISOString(), inboundPreview: customerText, logId: undefined },
    }))
    return conv
  }

  it("sends the card to every linked admin — not to support, not to another organization — and no plain bell copy", async () => {
    await conversationWithDraft("Salam, Aysel! 5 nəfərlik komanda üçün paketimiz var, detalları yazım?")
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(cards().map((c) => c.body.chat_id).sort()).toEqual(["6001", "6002"])
    const card = String(cards()[0].body.text)
    expect(card).toContain("Instagram · @leaddrive.az")
    expect(card).toContain("Aysel Məmmədova")
    expect(card).toContain("5 nəfərlik komanda üçün")
    expect(card).toContain("paketimiz var")
    expect(callbacks("6001").map((d) => d.slice(-2))).toEqual([":s", ":e", ":x"])
    expect(net.tg.some((c) => c.method === "sendMessage" && String(c.body.text).includes("AI подготовил"))).toBe(false)
    expect(net.meta).toEqual([])
  })

  it("«Göndər» sends the draft to the customer once, closes the colleague's card and counts for training", async () => {
    const conv = await conversationWithDraft("Salam! Bəli, 5 nəfər üçün uyğun paketimiz var.")
    const [send] = callbacks("6001")
    await press(6001, send)
    await press(6001, send)
    const [kamranSend] = callbacks("6002")
    await press(6002, kamranSend)

    expect(net.meta).toEqual([{ recipient: { id: `ig-cust-${draftSeq}` }, text: "Salam! Bəli, 5 nəfər üçün uyğun paketimiz var." }])
    await vi.waitFor(() => expect(edits("6002").some((t) => t.includes("artıq cavab verilib"))).toBe(true))
    expect(edits("6001").some((t) => t.includes("✅ Göndərildi — Leyla"))).toBe(true)
    const out = await bypass(() => prisma.channelMessage.findMany({ where: { organizationId: ORG, conversationId: conv.id, direction: "outbound" } }))
    expect(out).toHaveLength(1)
    expect(out[0].metadata).toMatchObject({ aiDraftApproved: true, approvedBy: "u-leyla" })
    const draftLeft = await bypass(() => prisma.socialConversation.findFirst({ where: { id: conv.id }, select: { metadata: true } }))
    expect((draftLeft?.metadata as Record<string, unknown> | null)?.aiDraft).toBeUndefined()
    const sample = await bypass(() => prisma.inboxLearningSample.findFirst({ where: { organizationId: ORG, answerMessageId: out[0].id } }))
    expect(sample).toMatchObject({ verdict: "same", resolution: "accepted", resolvedById: "u-leyla", channelConfigId: channelId })
  })

  it("two admins pressing at the same moment send one message", async () => {
    await conversationWithDraft("Bəli, quraşdırma pulsuzdur.")
    // Straight to the handler: the webhook route serializes one bot's updates by update_id, two
    // employees' presses reach separate requests in production all the same.
    const { pressDraftCard } = await import("@/lib/inbox/ai-draft-telegram")
    const links = await bypass(() => prisma.telegramStaffLink.findMany({ where: { organizationId: ORG, userId: { in: ["u-leyla", "u-kamran"] } }, orderBy: { telegramUserId: "asc" } }))
    const ids = [callbacks("6001")[0], callbacks("6002")[0]].map((data) => data.split(":")[1])
    const results = await Promise.all(links.map((link: (typeof links)[number], i: number) => tenant(ORG, () => pressDraftCard({ link, actionId: ids[i], choice: "s" }))))
    expect(net.meta).toHaveLength(1)
    expect(results.filter((r) => r.card?.text.includes("✅ Göndərildi"))).toHaveLength(1)
  })

  it("«Düzəlt» sends the employee's own next message and teaches it; a price in it waits for «Подтвердить»", async () => {
    const conv = await conversationWithDraft("5 nəfər üçün qiyməti menecer dəqiqləşdirəcək.")
    await press(6001, callbacks("6001")[1])
    expect(edits("6001").at(-1)).toContain("Mətninizi bir mesajla yazın")
    await write(6001, "5 nəfərlik komanda üçün ayda 120 AZN-dir, 14 gün pulsuz sınaq var.")

    expect(net.meta.map((m) => m.text)).toEqual(["5 nəfərlik komanda üçün ayda 120 AZN-dir, 14 gün pulsuz sınaq var."])
    expect(net.tg.some((c) => c.method === "sendMessage" && c.body.chat_id === "6001" && c.body.text === "Göndərildi.")).toBe(true)
    const out = await bypass(() => prisma.channelMessage.findFirst({ where: { organizationId: ORG, conversationId: conv.id, direction: "outbound" } }))
    expect(out?.metadata).toMatchObject({ authorType: "operator", authorUserId: "u-leyla", aiAutoReply: false })
    const sample = await bypass(() => prisma.inboxLearningSample.findFirst({ where: { organizationId: ORG, answerMessageId: out!.id } }))
    expect(sample).toMatchObject({ verdict: "different", resolution: "taught" })
    const item = await bypass(() => prisma.inboxLearnedItem.findFirst({ where: { organizationId: ORG, sourceMessageId: out!.id } }))
    expect(item).toMatchObject({ kind: "knowledge", status: "pending", channelConfigId: channelId })
    // The next message is the assistant's again, not a second correction.
    expect(await bypass(() => prisma.telegramStaffAction.count({ where: { organizationId: ORG, status: "awaiting_text" } }))).toBe(0)
  })

  it("an answer from the CRM turns the cards into «artıq cavab verilib», and a later press sends nothing", async () => {
    const conv = await conversationWithDraft("Bəli, inteqrasiya var.")
    const n = draftSeq
    await tenant(ORG, () => sendReply({
      organizationId: ORG, channel: "instagram", to: `ig-cust-${n}`, body: "Salam, mən Rəşadam, sizə zəng edim?", conversationId: conv.id, channelConfigId: channelId,
      extraMetadata: { authorType: "operator", authorUserId: "u-kamran", authorName: "Kamran" },
    }))
    await vi.waitFor(() => expect(edits("6001").some((t) => t.includes("artıq cavab verilib"))).toBe(true))
    net.meta = []
    await press(6001, callbacks("6001")[0])
    expect(net.meta).toEqual([])
  })

  it("«Özüm yazacam» sends nothing and tells the colleague who took it", async () => {
    const conv = await conversationWithDraft("Bəli, Android tətbiqi var.")
    await press(6002, callbacks("6002")[2])
    expect(net.meta).toEqual([])
    expect(edits("6002").at(-1)).toContain("Özünüz yazacaqsınız")
    await vi.waitFor(() => expect(edits("6001").some((t) => t.includes("Kamran özü yazacaq"))).toBe(true))
    const left = await bypass(() => prisma.socialConversation.findFirst({ where: { id: conv.id }, select: { metadata: true } }))
    expect((left?.metadata as Record<string, unknown>).aiDraft).toBeTruthy()
  })

  it("another organization's employee cannot press our card", async () => {
    await conversationWithDraft("Bəli, 24/7 dəstək var.")
    const ours = callbacks("6001")[0]
    await press(7001, ours, OTHER_ORG)
    expect(net.meta).toEqual([])
    const id = ours.split(":")[1]
    expect(await bypass(() => prisma.telegramStaffAction.findFirst({ where: { id }, select: { status: true } }))).toEqual({ status: "pending" })
    const answered = net.tg.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text)
    expect(answered).toContain("Bu artıq aktual deyil.")
  })

  it("a draft with a blank cannot go as it is", async () => {
    await conversationWithDraft("5 nəfər üçün qiymət ayda ___ AZN-dir.")
    expect(String(cards()[0].body.text)).toContain("«___» yerinə özünüz yazın")
    await press(6001, callbacks("6001")[0])
    expect(net.meta).toEqual([])
    expect(net.tg.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text)).toContain("Mətndə «___» var — «Düzəlt» basıb tam mətni yazın.")
  })

  it("with the switch off, no card goes", async () => {
    await bypass(() => prisma.channelConfig.update({ where: { id: channelId }, data: { settings: { replyMode: "ai", draftMode: true } } }))
    await conversationWithDraft("Bəli.")
    expect(cards()).toEqual([])
    await bypass(() => prisma.channelConfig.update({ where: { id: channelId }, data: { settings: { replyMode: "ai", draftMode: true, telegramDrafts: true } } }))
  })
})
