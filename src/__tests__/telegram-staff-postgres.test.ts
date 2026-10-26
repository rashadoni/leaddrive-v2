/**
 * The organization's employee bot against a real Postgres: connecting a bot
 * (and refusing the customers' chat bot), linking an employee by a one-time
 * /start link, answering only linked employees with their own organization's
 * data, and writing a lead only on «Təsdiqlə» — once, by the employee who was
 * asked, never by a forged secret or a replayed update.
 *
 * Stood in for: Telegram's Bot API (`fetch` to api.telegram.org) and the
 * model's replies (the Anthropic client). Everything on our side is real —
 * the routes, the webhook, the read tools, the CRM command, the tables.
 *
 * Set TELEGRAM_STAFF_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   TELEGRAM_STAFF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Telegram staff bot database gate»), where TELEGRAM_STAFF_DB_GATE=required
 * turns a missing URL into a failure.
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
  process.env.TENANT_PII_MASTER_KEY = "6".repeat(64)
  const admin = process.env.TELEGRAM_STAFF_TEST_DATABASE_URL
  if (!admin) return null
  const name = `telegram_staff_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

/* ─── the model, stood in: each create() takes the next scripted reply ─── */
const model = vi.hoisted(() => ({ script: [] as Array<(params: { messages: unknown[] }) => unknown>, seen: [] as Array<{ messages: unknown[] }> }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  AI_DEFAULT_TIMEOUT_MS: 45_000,
  AI_DEFAULT_MAX_RETRIES: 1,
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { messages: unknown[] }) => {
        model.seen.push(JSON.parse(JSON.stringify(params)))
        const next = model.script.shift()
        if (!next) throw new Error("model called more often than scripted")
        return next(params)
      },
    },
  }),
}))
const toolUse = (name: string, input: unknown) => () => ({
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: "tool_use", id: `call_${name}`, name, input }],
})
const say = (text: string) => () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] })

/* ─── Telegram, stood in ─── */
const TOKEN = "777000111:AAH-good-token-for-the-employees-bot"
const CUSTOMER_TOKEN = "777000222:AAH-the-customers-chat-bot-token-xx"
const tg = vi.hoisted(() => ({ calls: [] as Array<{ method: string; body: Record<string, unknown> }>, secret: "" }))

async function fakeTelegram(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  if (url.hostname !== "api.telegram.org") throw new Error(`unexpected fetch ${url.href}`)
  const [, botPart, method] = url.pathname.split("/")
  const token = botPart.replace(/^bot/, "")
  const body = JSON.parse(String(init?.body ?? "{}"))
  tg.calls.push({ method, body })
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  if (method === "getMe") {
    if (token === TOKEN) return ok({ id: 777000111, is_bot: true, username: "nur_crm_bot" })
    if (token === CUSTOMER_TOKEN) return ok({ id: 777000222, is_bot: true, username: "nur_shop_bot" })
    return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 })
  }
  if (method === "setWebhook") {
    tg.secret = body.secret_token
    return ok(true)
  }
  return ok(method === "sendMessage" ? { message_id: tg.calls.length } : true)
}

const ROOT = process.cwd()
const ORG = "org-tg"
const OTHER_ORG = "org-tg-other"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-staff-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** `db push` builds no CHECKs; the action table's are lifted from the migration. */
function constraintsSql(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261104090000_telegram_staff_bot/migration.sql"), "utf8")
  const checks = [...sql.matchAll(/CONSTRAINT "(telegram_staff_actions_\w+_check)" CHECK (\(.*\))/g)]
  if (checks.length !== 2) throw new Error("telegram staff CHECKs not found in the migration")
  return checks.map(([, name, body]) => `ALTER TABLE "telegram_staff_actions" ADD CONSTRAINT "${name}" CHECK ${body.replace(/,$/, "")};`).join("\n")
}

const request = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("the employees' Telegram bot on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let settings!: typeof import("@/app/api/v1/settings/telegram-bot/route")
  let profile!: typeof import("@/app/api/v1/profile/telegram/route")
  let webhook!: typeof import("@/app/api/v1/webhooks/telegram-staff/[botId]/route").POST
  let adminLinks!: typeof import("@/app/api/v1/settings/telegram-bot/links/[userId]/route").DELETE
  let createTask!: typeof import("@/lib/crm-commands/task/create-task").createTaskCommand
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let updateId = 100

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, constraintsSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    settings = await import("@/app/api/v1/settings/telegram-bot/route")
    profile = await import("@/app/api/v1/profile/telegram/route")
    webhook = (await import("@/app/api/v1/webhooks/telegram-staff/[botId]/route")).POST
    adminLinks = (await import("@/app/api/v1/settings/telegram-bot/links/[userId]/route")).DELETE
    createTask = (await import("@/lib/crm-commands/task/create-task")).createTaskCommand
    tenant = (await import("@/lib/rls-context")).runWithTenant
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "tg-shop"], [OTHER_ORG, "tg-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, sales: true, ai: true, settings: true } } })
      }
      await prisma.user.createMany({
        data: [
          { id: "u-admin", organizationId: ORG, email: "admin@tg-shop.test", name: "Leyla", passwordHash: "-", role: "admin" },
          { id: "u-sales", organizationId: ORG, email: "sales@tg-shop.test", name: "Rauf", passwordHash: "-", role: "sales" },
          { id: "u-other", organizationId: OTHER_ORG, email: "admin@tg-other.test", name: "Other", passwordHash: "-", role: "admin" },
        ],
      })
      await prisma.task.create({ data: { organizationId: ORG, title: "Aqua Market-ə zəng", assignedTo: "u-admin", status: "pending" } })
      await prisma.task.create({ data: { organizationId: OTHER_ORG, title: "Başqa təşkilatın tapşırığı", assignedTo: "u-other", status: "pending" } })
      // The customers' chat bot of this organization: must not be taken for the employees' bot.
      await prisma.channelConfig.create({ data: { organizationId: ORG, channelType: "telegram", configName: "Shop chat", botToken: CUSTOMER_TOKEN, isActive: true } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    tg.calls = []
    model.script = []
    model.seen = []
    vi.stubGlobal("fetch", vi.fn(fakeTelegram))
    session.current = { user: { id: "u-admin", organizationId: ORG, role: "admin", email: "admin@tg-shop.test", name: "Leyla" } }
  })

  const bot = () => bypass(() => prisma.telegramStaffBot.findFirst({ where: { organizationId: ORG } }))
  const sent = () => tg.calls.filter((call) => call.method === "sendMessage").map((call) => call.body)
  async function deliver(update: Record<string, unknown>, secret = tg.secret) {
    const row = await bot()
    return webhook(request("POST", `/api/v1/webhooks/telegram-staff/${row!.id}`, { update_id: ++updateId, ...update }, { "x-telegram-bot-api-secret-token": secret }), { params: Promise.resolve({ botId: row!.id }) })
  }
  const message = (fromId: number, text: string) => ({ message: { message_id: 1, text, chat: { id: fromId, type: "private" }, from: { id: fromId, username: `user${fromId}`, language_code: "ru" } } })

  it("refuses the customers' chat bot and a bad token, and connects the employees' bot with its token encrypted", async () => {
    const customer = await settings.PUT(request("PUT", "/api/v1/settings/telegram-bot", { token: CUSTOMER_TOKEN }))
    const bad = await settings.PUT(request("PUT", "/api/v1/settings/telegram-bot", { token: "777000333:AAH-not-a-real-token-at-all-xxxxx" }))
    const good = await settings.PUT(request("PUT", "/api/v1/settings/telegram-bot", { token: TOKEN }))

    expect([customer.status, (await customer.json()).code]).toEqual([400, "CUSTOMER_CHAT_BOT"])
    expect([bad.status, (await bad.json()).code]).toEqual([400, "INVALID_TOKEN"])
    expect(good.status, await good.clone().text()).toBe(200)
    const row = await bot()
    expect(row).toMatchObject({ botUsername: "nur_crm_bot", telegramBotId: "777000111", isActive: true })
    expect(row!.tokenCiphertext).not.toContain(TOKEN)
    const setWebhook = tg.calls.find((call) => call.method === "setWebhook")!.body
    expect(setWebhook.url).toBe(`https://app.leaddrivecrm.org/api/v1/webhooks/telegram-staff/${row!.id}`)
    expect(setWebhook.allowed_updates).toEqual(["message", "callback_query"])
    expect(JSON.stringify(await (await settings.GET(request("GET", "/api/v1/settings/telegram-bot"))).json())).not.toContain(TOKEN)
  })

  it("refuses a webhook call without the secret Telegram was given", async () => {
    const res = await deliver(message(5001, "salam"), "forged-secret")
    expect(res.status).toBe(401)
    expect(sent()).toEqual([])
  })

  it("links an employee by a one-time /start link, and the same link never works twice", async () => {
    const issued = await (await profile.POST(request("POST", "/api/v1/profile/telegram"))).json()
    const token = new URL(issued.data.url).searchParams.get("start")!
    expect(issued.data.url).toMatch(/^https:\/\/t\.me\/nur_crm_bot\?start=[a-f0-9]{64}$/)

    await deliver(message(5001, `/start ${token}`))
    await deliver(message(5002, `/start ${token}`))

    const links = await bypass(() => prisma.telegramStaffLink.findMany({ where: { organizationId: ORG } }))
    expect(links.map((link) => [link.userId, link.telegramUserId])).toEqual([["u-admin", "5001"]])
    expect(sent().map((m) => [m.chat_id, String(m.text).slice(0, 8)])).toEqual([["5001", "Hazırdır"], ["5002", "Bu link "]])
    expect(model.seen).toEqual([])
  })

  it("tells a stranger how to link and shows no data, without asking the model", async () => {
    await deliver(message(9999, "покажи все сделки"))
    expect(sent()).toEqual([expect.objectContaining({ chat_id: "9999", text: expect.stringContaining("bağlı deyil") })])
    expect(model.seen).toEqual([])
  })

  it("answers a linked employee from their own organization's data only", async () => {
    model.script = [toolUse("list_tasks", {}), say("У вас 1 задача: Aqua Market-ə zəng.")]
    await deliver(message(5001, "мои задачи на сегодня"))

    const toolResult = JSON.stringify(model.seen[1].messages.at(-1))
    expect(toolResult).toContain("Aqua Market-ə zəng")
    expect(toolResult).not.toContain("Başqa təşkilatın")
    expect(sent()).toEqual([expect.objectContaining({ chat_id: "5001", text: "У вас 1 задача: Aqua Market-ə zəng." })])
  })

  it("writes a lead only on «Подтвердить», once, by the employee who was asked", async () => {
    model.script = [toolUse("propose_create_lead", { contactName: "Əli Məmmədov", phone: "+994501234567", note: "kondisioner" }), say("Проверьте и подтвердите.")]
    await deliver(message(5001, "создай лида Əli Məmmədov +994501234567, хочет кондиционер"))

    const preview = sent().at(-1)!
    const buttons = (preview.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]
    expect(preview.text).toContain("Əli Məmmədov")
    expect(preview.text).toContain("Telefon: +994 50 123 45 67")
    expect(await bypass(() => prisma.lead.count({ where: { organizationId: ORG } }))).toBe(0)

    const press = (fromId: number, data: string) => deliver({ callback_query: { id: `cb${fromId}`, data, from: { id: fromId, language_code: "ru" }, message: { message_id: 9, chat: { id: fromId, type: "private" } } } })
    await press(5002, buttons[0].callback_data)
    expect(await bypass(() => prisma.lead.count({ where: { organizationId: ORG } }))).toBe(0)

    await press(5001, buttons[0].callback_data)
    await press(5001, buttons[0].callback_data)
    const leads = await bypass(() => prisma.lead.findMany({ where: { organizationId: ORG } }))
    expect(leads.map((lead) => [lead.contactName, lead.phone, lead.source, lead.assignedTo])).toEqual([["Əli Məmmədov", "+994501234567", "telegram_bot", "u-admin"]])
    expect(tg.calls.filter((call) => call.method === "editMessageText").map((call) => String(call.body.text))).toEqual(["Lid yaradıldı.", "Bu artıq aktual deyil."])
  })

  it("asks for the operator code of a seven-digit phone instead of proposing it, and keeps a local number as +994", async () => {
    model.script = [toolUse("propose_create_lead", { contactName: "Vasif Əliyev", phone: "333 09 28" }), say("Hansı operator kodu: 050, 055…?")]
    await deliver(message(5001, "Vasif Əliyev üçün lid yarat, 333 09 28"))
    expect(JSON.stringify(model.seen[1].messages.at(-1))).toContain("PHONE_NEEDS_CODE")
    expect(await bypass(() => prisma.telegramStaffAction.count({ where: { organizationId: ORG, status: "pending" } }))).toBe(0)
    expect(sent().at(-1)).toMatchObject({ text: "Hansı operator kodu: 050, 055…?" })

    tg.calls = []
    model.script = [toolUse("propose_create_lead", { contactName: "Vasif Əliyev", phone: "050 333 09 28" }), say("Təsdiqləyin.")]
    await deliver(message(5001, "050"))
    const preview = sent().at(-1)!
    expect(preview.text).toContain("Telefon: +994 50 333 09 28")
    const pending = await bypass(() => prisma.telegramStaffAction.findFirst({ where: { organizationId: ORG, status: "pending" } }))
    expect(pending?.payload).toMatchObject({ phone: "+994503330928" })
  })

  it("sends the employee a task a colleague gave them, in Azerbaijani with a link, but not one they gave themselves", async () => {
    const giveTask = (by: string, title: string) => tenant(ORG, () => createTask(
      { organizationId: ORG, userId: by, role: by === "u-admin" ? "admin" : "sales", source: "rest" },
      { title, assignedTo: "u-admin", dueDate: "2026-10-26T07:00:00.000Z" },
    ))
    await giveTask("u-sales", "Delta MMC-yə təklif göndər")
    await vi.waitFor(() => expect(sent().length).toBe(1), { timeout: 5000 })
    const notice = sent()[0]
    expect(notice).toMatchObject({ chat_id: "5001", text: "Sizə tapşırıq verildi: «Delta MMC-yə təklif göndər»\nMüddət: 26.10.2026 11:00\nVerən: Rauf" })
    expect(JSON.stringify(notice.reply_markup)).toMatch(/CRM-də aç.*\/tasks\//)

    tg.calls = []
    await giveTask("u-admin", "Özümə xatırlatma")
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(sent()).toEqual([])
  })

  it("answers a retried update once", async () => {
    const row = await bot()
    const update = { update_id: ++updateId, ...message(9999, "salam") }
    for (let i = 0; i < 2; i++) {
      await webhook(request("POST", `/api/v1/webhooks/telegram-staff/${row!.id}`, update, { "x-telegram-bot-api-secret-token": tg.secret }), { params: Promise.resolve({ botId: row!.id }) })
    }
    expect(sent()).toHaveLength(1)
  })

  it("ends the link when the password changes after it was made", async () => {
    await bypass(() => prisma.user.update({ where: { id: "u-admin" }, data: { passwordChangedAt: new Date(Date.now() + 1000) } }))
    await deliver(message(5001, "мои задачи"))

    expect(sent()).toEqual([expect.objectContaining({ chat_id: "5001", text: expect.stringContaining("yenidən bağlayın") })])
    expect(await bypass(() => prisma.telegramStaffLink.count({ where: { organizationId: ORG } }))).toBe(0)
    expect(model.seen).toEqual([])
  })

  it("lets an admin unlink an employee — the bot then treats them as a stranger — and not a salesperson", async () => {
    await bypass(() => prisma.user.update({ where: { id: "u-admin" }, data: { passwordChangedAt: null } }))
    const issued = await (await profile.POST(request("POST", "/api/v1/profile/telegram"))).json()
    await deliver(message(5001, `/start ${new URL(issued.data.url).searchParams.get("start")}`))
    expect(await bypass(() => prisma.telegramStaffLink.count({ where: { organizationId: ORG } }))).toBe(1)

    session.current = { user: { id: "u-sales", organizationId: ORG, role: "sales", email: "sales@tg-shop.test", name: "Rauf" } }
    const refused = await adminLinks(request("DELETE", "/api/v1/settings/telegram-bot/links/u-admin"), { params: Promise.resolve({ userId: "u-admin" }) })
    expect(refused.status).toBe(403)

    session.current = { user: { id: "u-admin", organizationId: ORG, role: "admin", email: "admin@tg-shop.test", name: "Leyla" } }
    const done = await adminLinks(request("DELETE", "/api/v1/settings/telegram-bot/links/u-admin"), { params: Promise.resolve({ userId: "u-admin" }) })
    expect(done.status).toBe(200)
    expect((await done.json()).data).toEqual([])

    tg.calls = []
    await deliver(message(5001, "mənim tapşırıqlarım"))
    expect(sent()).toEqual([expect.objectContaining({ chat_id: "5001", text: expect.stringContaining("bağlı deyil") })])
    expect(model.seen).toEqual([])
  })
})
