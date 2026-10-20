/**
 * Who receives an organization's finance notices in Telegram, read off the
 * requests that actually leave for api.telegram.org.
 *
 * Until 2026-10-07 the notifier took its bot and its chat from two environment
 * variables, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_FINANCE_CHAT_ID` — one pair for
 * the whole installation. Every tenant with the Finance module had Telegram
 * switched on by default, so a payment order of any of them (number,
 * counterparty, amount, purpose) was addressed to whoever sat in that one chat.
 * The nightly deadline job did the same with each tenant's overdue counts.
 *
 * Both variables are set here before anything is imported, to well-formed
 * values: that is the exact state in which the old code leaked, and the state
 * in which the new code has to stay silent.
 *
 * The real handlers run with the real `requireAuth`, the real RLS wrappers and
 * the real Prisma client over a scratch database built from schema.prisma, so
 * the settings an organization saves are the settings the notifier reads back.
 * Two things are stand-ins: the session cookie (who is calling), and `fetch` —
 * which answers for api.telegram.org, records where each message was headed,
 * and refuses every other host.
 *
 * The same requests show what a notice says. It is sent with
 * `parse_mode: "HTML"`, so whatever a tenant typed into a counterparty or a
 * purpose has to arrive as text: Telegram refuses a whole message over one `<`
 * it cannot read as a tag — and the notifier swallows that refusal on purpose —
 * while a value that is a tag would be a link posted by the organization's bot.
 *
 * Set FINANCE_TELEGRAM_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   FINANCE_TELEGRAM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Finance Telegram recipient database gate»), where
 * `FINANCE_TELEGRAM_DB_GATE=required` turns a missing URL into a failure so the
 * gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { APP_URL } from "@/lib/domains"

const adminUrl = process.env.FINANCE_TELEGRAM_TEST_DATABASE_URL
if (!adminUrl && process.env.FINANCE_TELEGRAM_DB_GATE === "required") {
  throw new Error("FINANCE_TELEGRAM_TEST_DATABASE_URL is required by the finance Telegram recipient database gate")
}

// None of these is a credential: no such bots exist.
const INSTALLATION = vi.hoisted(() => {
  // The pair the notifier used to read at import time.
  const pair = { bot: "999999999:installation-wide-bot-token-for-tests", chat: "-1009999999999" }
  process.env.TELEGRAM_BOT_TOKEN = pair.bot
  process.env.TELEGRAM_FINANCE_CHAT_ID = pair.chat
  return pair
})
const A = { id: "org-a", bot: "111111111:org-a-own-finance-bot-token-for-tests", chat: "-1001111111111" }
const B = { id: "org-b", bot: "222222222:org-b-own-finance-bot-token-for-tests", chat: "-1002222222222" }
/** Has the Finance module and the default settings — Telegram ticked — but never set up a bot or a chat. */
const C = { id: "org-c" }

const scratch = vi.hoisted(() => {
  const admin = process.env.FINANCE_TELEGRAM_TEST_DATABASE_URL
  if (!admin) return null
  const name = `finance_telegram_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

/** Every request that left the process, in order. */
const outbound = {
  telegram: [] as { bot: string; chat: string; text: string }[],
  elsewhere: [] as string[],
  /** What Telegram answers; null is its ordinary 200. */
  answer: null as (() => Response) | null,
}

function stubFetch() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const sendMessage = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/)
    if (!sendMessage) {
      outbound.elsewhere.push(url)
      throw new Error(`unexpected outbound request to ${new URL(url).host}`)
    }
    const body = JSON.parse(String(init?.body)) as { chat_id: unknown; text: string }
    outbound.telegram.push({ bot: sendMessage[1], chat: String(body.chat_id), text: body.text })
    return outbound.answer ? outbound.answer() : new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
}

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const SETTINGS_URL = "http://localhost:3000/api/finance/payment-orders/notification-settings"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "finance-telegram-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function signIn(orgId: string, role = "admin") {
  session.current = {
    user: { id: `user-${orgId}`, organizationId: orgId, role, email: `${role}@${orgId}.example`, name: role },
  }
}

function request(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

/** The settings form as the page submits it, Telegram left ticked everywhere (the default). */
const FORM = {
  recipientEmail: "",
  overdue: { enabled: true, channels: ["telegram"] },
  advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 },
  paymentOrders: { enabled: true, channels: ["telegram"] },
  billPayments: { enabled: true, channels: ["telegram"] },
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("finance notices in Telegram on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let getSettings!: typeof import("@/app/api/finance/payment-orders/notification-settings/route").GET
  let putSettings!: typeof import("@/app/api/finance/payment-orders/notification-settings/route").PUT
  let sendTest!: typeof import("@/app/api/finance/payment-orders/notification-settings/test/route").POST
  let submit!: typeof import("@/app/api/finance/payment-orders/[id]/submit/route").POST
  let execute!: typeof import("@/app/api/finance/payment-orders/[id]/execute/route").POST
  let payBill!: typeof import("@/app/api/finance/payables/[id]/payments/route").POST
  let checkDeadlines!: typeof import("@/app/api/finance/payment-orders/check-deadlines/route").POST
  let runDeadlineJob!: typeof import("@/lib/cron/finance-deadline-job").runFinanceDeadlineJob
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    stubFetch()
    // No mail provider, whatever the machine has: `sendEmail` then records the
    // message it would have sent in email_logs and stops.
    for (const name of ["SMTP_USER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN"]) delete process.env[name]
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    ;({ GET: getSettings, PUT: putSettings } = await import("@/app/api/finance/payment-orders/notification-settings/route"))
    sendTest = (await import("@/app/api/finance/payment-orders/notification-settings/test/route")).POST
    submit = (await import("@/app/api/finance/payment-orders/[id]/submit/route")).POST
    execute = (await import("@/app/api/finance/payment-orders/[id]/execute/route")).POST
    payBill = (await import("@/app/api/finance/payables/[id]/payments/route")).POST
    checkDeadlines = (await import("@/app/api/finance/payment-orders/check-deadlines/route")).POST
    runDeadlineJob = (await import("@/lib/cron/finance-deadline-job")).runFinanceDeadlineJob
    for (const org of [A, B, C]) {
      await bypass(() => prisma.organization.create({
        data: { id: org.id, name: `Tenant ${org.id}`, slug: org.id, modules: { crm: true, finance: true } },
      }))
      await bypass(() => prisma.user.create({
        data: { id: `user-${org.id}`, organizationId: org.id, email: `admin@${org.id}.example`, name: "Admin", passwordHash: "x", role: "admin" },
      }))
    }
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    outbound.telegram = []
    outbound.elsewhere = []
    outbound.answer = null
    await bypass(() => prisma.organization.updateMany({ data: { settings: {} } }))
    await bypass(() => prisma.notification.deleteMany({}))
  })

  /** Save the settings form as that organization's administrator would. */
  async function save(orgId: string, form: Record<string, unknown>, role = "admin") {
    signIn(orgId, role)
    return putSettings(request(SETTINGS_URL, "PUT", form))
  }

  async function connect(org: { id: string; bot: string; chat: string }) {
    const res = await save(org.id, { ...FORM, telegramBotToken: org.bot, telegramChatId: org.chat })
    expect(res.status).toBe(200)
  }

  /** What the database holds for an organization — the token as stored, not as shown. */
  async function stored(orgId: string): Promise<Record<string, unknown>> {
    const org = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } }))
    return ((org.settings as Record<string, unknown>).financeNotifications ?? {}) as Record<string, unknown>
  }

  /** An organization submits a payment order for approval: the event that notifies. */
  async function submitOrder(orgId: string, counterpartyName: string, purpose = `Confidential purpose of ${orgId}`) {
    const id = `po-${++sequence}`
    await bypass(() => prisma.paymentOrder.create({
      data: {
        id,
        organizationId: orgId,
        orderNumber: `PO-${orgId}-${sequence}`,
        counterpartyName,
        amount: 12_500,
        purpose,
        status: "draft",
      },
    }))
    signIn(orgId, "manager")
    const res = await submit(request(`http://localhost:3000/api/finance/payment-orders/${id}/submit`, "POST"), idParams(id))
    expect(res.status).toBe(200)
    const order = await bypass(() => prisma.paymentOrder.findUniqueOrThrow({ where: { id } }))
    expect(order.status).toBe("pending_approval")
    return order.orderNumber
  }

  const sentTo = (chat: string) => outbound.telegram.filter((message) => message.chat === chat)

  it("sends an organization's payment order to its own chat through its own bot, and nowhere else", async () => {
    await connect(A)
    await connect(B)

    const orderA = await submitOrder(A.id, "Supplier Of A LLC")

    expect(outbound.telegram).toHaveLength(1)
    expect(outbound.telegram[0]).toMatchObject({ bot: A.bot, chat: A.chat })
    expect(outbound.telegram[0].text).toContain(orderA)
    expect(outbound.telegram[0].text).toContain("Supplier Of A LLC")
    expect(sentTo(B.chat)).toEqual([])
    expect(sentTo(INSTALLATION.chat)).toEqual([])

    const orderB = await submitOrder(B.id, "Supplier Of B LLC")

    expect(outbound.telegram).toHaveLength(2)
    expect(outbound.telegram[1]).toMatchObject({ bot: B.bot, chat: B.chat })
    expect(outbound.telegram[1].text).toContain(orderB)
    // Nothing of A's ever reached B's chat, nor B's bot.
    expect(sentTo(B.chat).map((message) => message.text).join("\n")).not.toContain("Supplier Of A LLC")
    expect(outbound.telegram.filter((message) => message.bot === B.bot)).toHaveLength(1)
    expect(outbound.telegram.some((message) => message.bot === INSTALLATION.bot || message.chat === INSTALLATION.chat)).toBe(false)
    expect(outbound.elsewhere).toEqual([])
  })

  it("sends nothing to Telegram for an organization that has not set up a chat, whatever the environment holds", async () => {
    await connect(A)
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe(INSTALLATION.bot)
    expect(process.env.TELEGRAM_FINANCE_CHAT_ID).toBe(INSTALLATION.chat)

    // C never opened the settings page: Telegram is ticked for it by default.
    await submitOrder(C.id, "Supplier Of C LLC")

    expect(outbound.telegram).toEqual([])
  })

  it("treats a bot without a chat, or a chat without a bot, as not set up", async () => {
    expect((await save(A.id, { ...FORM, telegramBotToken: A.bot, telegramChatId: "" })).status).toBe(200)
    expect((await save(B.id, { ...FORM, telegramBotToken: "", telegramChatId: B.chat })).status).toBe(200)

    await submitOrder(A.id, "Supplier Of A LLC")
    await submitOrder(B.id, "Supplier Of B LLC")

    expect(outbound.telegram).toEqual([])
  })

  it("still delivers in the app to an organization without Telegram, and only to its own people", async () => {
    await connect(A)
    const inApp = { ...FORM, paymentOrders: { enabled: true, channels: ["telegram", "inApp"] } }
    expect((await save(C.id, inApp)).status).toBe(200)

    const order = await submitOrder(C.id, "Supplier Of C LLC")

    expect(outbound.telegram).toEqual([])
    const notices: { organizationId: string; userId: string; message: string }[] =
      await bypass(() => prisma.notification.findMany({}))
    expect(notices.map((notice) => [notice.organizationId, notice.userId])).toEqual([[C.id, `user-${C.id}`]])
    expect(notices[0].message).toContain(order)
  })

  it("stops when the organization disconnects its bot", async () => {
    await connect(A)
    await submitOrder(A.id, "Supplier Of A LLC")
    expect(outbound.telegram).toHaveLength(1)

    expect((await save(A.id, { ...FORM, telegramBotToken: "", telegramChatId: "" })).status).toBe(200)
    await submitOrder(A.id, "Supplier Of A LLC")

    expect(outbound.telegram).toHaveLength(1)
    expect(await stored(A.id)).toMatchObject({ telegramBotToken: "", telegramChatId: "" })
  })

  it("never returns a saved bot token, to a viewer or to the administrator who saved it", async () => {
    signIn(A.id)
    const saved = await putSettings(request(SETTINGS_URL, "PUT", { ...FORM, telegramBotToken: A.bot, telegramChatId: A.chat }))
    const savedText = await saved.text()

    signIn(A.id, "viewer")
    const read = await getSettings(request(SETTINGS_URL, "GET"))
    const readText = await read.text()

    expect([saved.status, read.status]).toEqual([200, 200])
    expect(savedText).not.toContain(A.bot)
    expect(readText).not.toContain(A.bot)
    expect(JSON.parse(readText).data).toMatchObject({ telegramBotTokenConfigured: true, telegramChatId: A.chat })
    expect((await stored(A.id)).telegramBotToken).toBe(A.bot)
  })

  it("keeps the saved bot when the form comes back with the mask, or without the Telegram fields at all", async () => {
    await connect(A)
    signIn(A.id)
    const shown = (await (await getSettings(request(SETTINGS_URL, "GET"))).json()).data

    // The page as it is now: it submits what it was shown, mask included.
    expect((await save(A.id, { ...shown, overdue: { enabled: false, channels: ["telegram"] } })).status).toBe(200)
    expect(await stored(A.id)).toMatchObject({ telegramBotToken: A.bot, telegramChatId: A.chat, overdue: { enabled: false } })

    // A tab opened before the fields existed: the old shape, no Telegram keys.
    expect((await save(A.id, FORM)).status).toBe(200)
    expect(await stored(A.id)).toMatchObject({ telegramBotToken: A.bot, telegramChatId: A.chat, overdue: { enabled: true } })

    await submitOrder(A.id, "Supplier Of A LLC")
    expect(outbound.telegram).toHaveLength(1)
    expect(outbound.telegram[0]).toMatchObject({ bot: A.bot, chat: A.chat })
  })

  it("refuses a token or a chat that is not one, and saves nothing", async () => {
    await connect(A)
    const before = await stored(A.id)

    // The token ends up in a URL path: nothing that could steer the path gets in.
    const badToken = await save(A.id, { ...FORM, telegramBotToken: "111111111:x/../../getUpdates?", telegramChatId: A.chat })
    const badChat = await save(A.id, { ...FORM, telegramBotToken: A.bot, telegramChatId: "the finance chat" })

    expect([badToken.status, (await badToken.json()).code]).toEqual([400, "invalid_telegram_bot_token"])
    expect([badChat.status, (await badChat.json()).code]).toEqual([400, "invalid_telegram_chat_id"])
    expect(await stored(A.id)).toEqual(before)
  })

  it("leaves another organization's settings alone", async () => {
    await connect(A)
    await connect(B)

    expect((await save(A.id, { ...FORM, telegramBotToken: A.bot, telegramChatId: "-1003333333333" })).status).toBe(200)

    expect(await stored(B.id)).toMatchObject({ telegramBotToken: B.bot, telegramChatId: B.chat })
    expect(await stored(C.id)).toEqual({})
  })

  it("sends the test message to the caller's own chat, and says why when Telegram refuses it", async () => {
    await connect(A)
    await connect(B)

    signIn(A.id, "manager")
    const ok = await sendTest(request(`${SETTINGS_URL}/test`, "POST"))
    expect(ok.status).toBe(200)
    expect(outbound.telegram).toHaveLength(1)
    expect(outbound.telegram[0]).toMatchObject({ bot: A.bot, chat: A.chat })

    outbound.answer = () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })
    const refused = await sendTest(request(`${SETTINGS_URL}/test`, "POST"))
    const refusedText = await refused.text()
    expect(refused.status).toBe(502)
    expect(JSON.parse(refusedText)).toMatchObject({ code: "telegram_rejected", detail: "Bad Request: chat not found" })
    expect(refusedText).not.toContain(A.bot)

    signIn(C.id, "manager")
    const notSetUp = await sendTest(request(`${SETTINGS_URL}/test`, "POST"))
    expect([notSetUp.status, (await notSetUp.json()).code]).toEqual([409, "telegram_not_configured"])
    expect(outbound.telegram).toHaveLength(2)
    expect(sentTo(B.chat)).toEqual([])
  })

  it("has the nightly deadline job tell each organization about its own overdue items only", async () => {
    await connect(A)
    await connect(B)
    const lastWeek = new Date(Date.now() - 7 * 86_400_000)
    const overdueBill = (orgId: string, n: number) => bypass(() => prisma.bill.create({
      data: { organizationId: orgId, billNumber: `B-${orgId}-${n}`, vendorName: "Landlord LLC", title: "Rent", status: "pending", totalAmount: "100", balanceDue: "100", dueDate: lastWeek },
    }))
    const overdueInvoice = (orgId: string, n: number) => bypass(() => prisma.invoice.create({
      data: { organizationId: orgId, invoiceNumber: `INV-${orgId}-${n}`, title: "Services", status: "sent", totalAmount: "100", balanceDue: "100", dueDate: lastWeek },
    }))
    await overdueBill(A.id, 1)
    await overdueInvoice(B.id, 1)
    await overdueInvoice(B.id, 2)
    await bypass(() => prisma.contract.create({
      data: { organizationId: B.id, contractNumber: "C-1", title: "Lease", status: "active", endDate: lastWeek },
    }))
    await overdueBill(C.id, 1)
    // A row no form could have written. The job reads every organization's
    // settings in one loop and must not trip over this one.
    await bypass(() => prisma.organization.update({
      where: { id: C.id },
      data: { settings: { financeNotifications: { overdue: "yes", telegramBotToken: 5, telegramChatId: ["x"] } } },
    }))

    const run = await runDeadlineJob()

    // The job did its work for all three, the one without a chat included.
    expect(run).toMatchObject({ status: "completed", value: { overdueBills: 2, overdueInvoices: 2, expiredContracts: 1 } })
    const bills = await bypass(() => prisma.bill.findMany({ select: { organizationId: true, status: true }, orderBy: { organizationId: "asc" } }))
    expect(bills).toEqual([{ organizationId: A.id, status: "overdue" }, { organizationId: C.id, status: "overdue" }])

    expect(sentTo(A.chat).map((message) => [message.bot, message.text.includes("Overdue bills: 1"), message.text.includes("Overdue invoices: 0")]))
      .toEqual([[A.bot, true, true]])
    const toB = sentTo(B.chat)
    expect(toB.map((message) => message.bot)).toEqual([B.bot, B.bot])
    expect(toB[0].text).toContain("Overdue bills: 0")
    expect(toB[0].text).toContain("Overdue invoices: 2")
    expect(toB[1].text).toContain("Expired: 1")
    // Three messages in all: nothing for C, nothing to the installation's chat.
    expect(outbound.telegram).toHaveLength(3)
    expect(outbound.telegram.some((message) => message.bot === INSTALLATION.bot || message.chat === INSTALLATION.chat)).toBe(false)
  })

  // ── What a notice says ──────────────────────────────────────────────────

  /** As a tenant may type them into a counterparty, a vendor or a purpose. */
  const NAME = "Smith & Sons <Baku>"
  const PURPOSE = 'Advance <a href="https://example.com">x</a>'

  /**
   * What is left of a Telegram message once the template's own markup is taken
   * out: `<b>`, and links into the app. Telegram's rule for HTML mode is that
   * every other `<`, `>` and `&` is an entity, so anything left here came from
   * data and either breaks the message or is markup nobody wrote.
   */
  function strayMarkup(text: string): string[] {
    return text
      .replace(/<a href="([^"]*)">/g, (tag, href: string) => (href.startsWith(`${APP_URL}/`) ? "" : tag))
      .replace(/<\/?b>|<\/a>/g, "")
      .match(/[<>]|&(?!(?:amp|lt|gt);)/g) ?? []
  }

  /** The message as the chat displays it: tags applied, entities decoded. */
  const shown = (text: string) =>
    text.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

  /** Where the links of an email lead, the app's own aside. */
  const foreignLinks = (html: string) =>
    [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((link) => link[1]).filter((href) => !href.startsWith(`${APP_URL}/`))

  const emailsOf = (orgId: string): Promise<{ subject: string | null; body: string | null }[]> =>
    bypass(() => prisma.emailLog.findMany({ where: { organizationId: orgId }, select: { subject: true, body: true }, orderBy: { createdAt: "asc" } }))

  it("delivers a counterparty and a purpose as the text that was typed, markup characters included", async () => {
    await connect(A)
    const everyChannel = { enabled: true, channels: ["telegram", "email", "inApp"] }
    expect((await save(A.id, { ...FORM, recipientEmail: "cfo@org-a.example", paymentOrders: everyChannel })).status).toBe(200)
    await bypass(() => prisma.emailLog.deleteMany({}))

    const order = await submitOrder(A.id, NAME, PURPOSE)

    expect(outbound.telegram).toHaveLength(1)
    const { text } = outbound.telegram[0]
    expect(text).toContain("🏢 Smith &amp; Sons &lt;Baku&gt;\n")
    expect(text).toContain('📝 Advance &lt;a href="https://example.com"&gt;x&lt;/a&gt;\n')
    // The template's own markup is still markup, and it is all the markup there is.
    expect(text).toContain("<b>Payment order pending approval</b>")
    expect(text).toContain(`<a href="${APP_URL}/finance?tab=payments">Approve / Reject</a>`)
    expect(strayMarkup(text)).toEqual([])
    expect(shown(text)).toContain(`📋 ${order}\n🏢 ${NAME}\n`)
    expect(shown(text)).toContain(`📝 ${PURPOSE}\n`)

    // The email is HTML as well. `sendEmail` sanitizes it, which removes what
    // is dangerous — not a link, and not the fact that `<Baku>` reads as a tag.
    const emails = await emailsOf(A.id)
    expect(emails.map((email) => email.subject)).toEqual([expect.stringContaining(order)])
    expect(emails[0].body).toContain("Smith &amp; Sons &lt;Baku&gt;")
    expect(emails[0].body).toContain('Advance &lt;a href="https://example.com"&gt;x&lt;/a&gt;')
    expect(emails[0].body).toContain(`<a href="${APP_URL}/finance?tab=payments">Approve / Reject</a>`)
    expect(foreignLinks(emails[0].body!)).toEqual([])

    // The in-app notice is plain text and is rendered as such: nothing to escape.
    const notices: { message: string }[] = await bypass(() => prisma.notification.findMany({ where: { organizationId: A.id } }))
    expect(notices.map((notice) => notice.message)).toEqual([expect.stringContaining(`— ${NAME}`)])
  })

  it("does the same in every other finance notice: executed order, bill payment, overdue items, deadlines", async () => {
    await connect(A)
    const both = { enabled: true, channels: ["telegram", "email"] }
    const form = { ...FORM, recipientEmail: "cfo@org-a.example", overdue: both, advance: { ...both, daysBeforeDeadline: 7 }, paymentOrders: both, billPayments: both }
    expect((await save(A.id, form)).status).toBe(200)
    await bypass(() => prisma.emailLog.deleteMany({}))
    const day = 86_400_000
    const bill = (billNumber: string, dueInDays: number) => bypass(() => prisma.bill.create({
      data: { organizationId: A.id, billNumber, vendorName: NAME, title: "Rent", status: "pending", totalAmount: "100", balanceDue: "100", dueDate: new Date(Date.now() + dueInDays * day) },
    }))
    const invoice = (invoiceNumber: string, dueInDays: number) => bypass(() => prisma.invoice.create({
      data: { organizationId: A.id, invoiceNumber, recipientName: NAME, title: "Services", status: "sent", totalAmount: "100", balanceDue: "100", dueDate: new Date(Date.now() + dueInDays * day) },
    }))
    signIn(A.id)

    // 1. A payment order is executed.
    await bypass(() => prisma.paymentOrder.create({
      data: { id: "po-typed", organizationId: A.id, orderNumber: "PO <7>", counterpartyName: NAME, amount: 300, currency: "A&B", purpose: PURPOSE, status: "approved" },
    }))
    const executed = await execute(request("http://localhost:3000/api/finance/payment-orders/po-typed/execute", "POST"), idParams("po-typed"))
    expect(executed.status).toBe(200)

    // 2. A payment is recorded against a bill.
    const paid = await bill("B <paid>", 60)
    const payment = await payBill(
      request(`http://localhost:3000/api/finance/payables/${paid.id}/payments`, "POST", { amount: 40, currency: "A&B" }),
      idParams(paid.id),
    )
    expect(payment.status).toBe(201)

    // 3–5. The deadline check finds overdue bills, overdue invoices and items due soon.
    await bill("B <late>", -7)
    await invoice("INV <late>", -7)
    await bill("B <soon>", 3)
    await invoice("INV <soon>", 3)
    const checked = await checkDeadlines(request("http://localhost:3000/api/finance/payment-orders/check-deadlines", "POST"))
    expect(checked.status).toBe(200)

    // Each notice by its heading, with what was typed into the records behind it.
    const notices = [
      ["Payment order executed", NAME, PURPOSE, "PO <7>", "A&B"],
      ["Bill payment recorded", NAME, "B <paid>", "A&B"],
      ["Overdue: ", NAME, "B <late>"],
      ["Overdue A/R: ", NAME, "INV <late>"],
      ["Deadlines in the next 7 day(s)", NAME, "B <soon>", "INV <soon>"],
    ]
    expect(outbound.telegram.map(({ text }) => text.split("\n")[0])).toEqual(notices.map(([heading]) => expect.stringContaining(heading)))
    outbound.telegram.forEach(({ text }, i) => {
      expect(strayMarkup(text), text).toEqual([])
      for (const typed of notices[i].slice(1)) expect(shown(text), text).toContain(typed)
    })

    const emails = await emailsOf(A.id)
    expect(emails).toHaveLength(notices.length)
    for (const { body } of emails) {
      expect(body, body!).toContain("Smith &amp; Sons &lt;Baku&gt;")
      expect(foreignLinks(body!), body!).toEqual([])
    }
    expect(emails[0].body).toContain("PO &lt;7&gt;")
    expect(emails[1].body).toContain("B &lt;paid&gt;")
  })
})
