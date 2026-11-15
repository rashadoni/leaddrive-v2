/**
 * The inbox panel's «AI rejimi» switch and its «Напомнить» (owner, 2026-11-15) on a real Postgres,
 * connected as an application role without BYPASSRLS. Only the outside world is stubbed — the
 * transports that would reach a customer, and the model — and every stub records what it was asked.
 *
 *  - Off for one conversation: the shared AI lease refuses it (maybeAiAutoReply, flow `ai_reply`,
 *    WhatsApp Da Vinci), the keyword bot, flow replies, the booking bot, the backlog sweep and the
 *    TikTok nudge stay silent there — and the conversation next to it is answered as before.
 *  - Switched off while a reply is being generated: the compare-and-set right before the send fails.
 *  - A person's own action still goes: an operator sending an AI draft, a bulk-close farewell.
 *  - The website chat's own pause follows the switch; back on, it is paused only if a person holds it.
 *  - Another organization cannot switch it.
 *  - A reminder rings once, in the bell, and a finished task stays quiet.
 *
 * Set INBOX_PANEL_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   INBOX_PANEL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Inbox panel
 * database gate»), where `INBOX_PANEL_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.INBOX_PANEL_TEST_DATABASE_URL
if (!adminUrl && process.env.INBOX_PANEL_DB_GATE === "required") {
  throw new Error("INBOX_PANEL_TEST_DATABASE_URL is required by the inbox panel database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.INBOX_PANEL_TEST_DATABASE_URL
  if (!admin) return null
  const name = `inbox_panel_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "inbox-panel-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.ANTHROPIC_API_KEY = "sk-ant-platform-key-for-tests" // gitleaks:allow — not a key
  delete process.env.VOYAGE_API_KEY
  return { name, role, adminDb: db.toString() }
})

/** Everything that would reach a customer, recorded instead of sent. */
const outbox = vi.hoisted(() => ({ sent: [] as Array<{ conversationId: string | null; body: string }> }))
vi.mock("@/lib/inbox/send-conversation-reply", () => ({
  sendConversationReply: async (opts: { conversationId?: string | null; body: string }) => {
    outbox.sent.push({ conversationId: opts.conversationId ?? null, body: opts.body })
    return { success: true, data: { id: `sent-${outbox.sent.length}`, status: "sent" } }
  },
}))
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: async (opts: { message?: string }) => {
    outbox.sent.push({ conversationId: null, body: String(opts.message ?? "") })
    return { success: true, messageId: `wamid-${outbox.sent.length}` }
  },
}))
// Classification and lead qualification run before the keyword bot and call the model; not ours.
vi.mock("@/lib/inbox/customer-stage-classifier", () => ({ maybeClassifyCustomerStage: async () => null }))
vi.mock("@/lib/inbox/lead-qualification", () => ({ maybeCreateQualifiedLeadTask: async () => null }))
// A push leaves the building; the bell row is what this suite reads.
vi.mock("@/lib/push-send", () => ({ sendPushToUser: async () => undefined }))
vi.mock("@/lib/telegram-staff/notify", () => ({ sendStaffTelegramNotice: async () => undefined }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-panel"
const OTHER = "org-panel-other"
const CHANNEL = "cfg-ig-panel"
const WA_CHANNEL = "cfg-wa-panel"
const OFF = "conv-off"
const ON = "conv-on"
const WA = "conv-wa"
const TT = "conv-tt"
const WEB = "conv-web"
const WEB_SESSION = "web-session-1"
const MANAGER = "user-manager"
const AGENT = "user-agent"
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "inbox-panel-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

;(scratch ? describe : describe.skip)("inbox panel: AI switch and reminders on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let autoReply!: typeof import("@/lib/inbox/conversation-auto-reply")
  let ai!: typeof import("@/lib/social/ai-autoreply")
  let keyword!: typeof import("@/lib/chatbot-autoreply")
  let actions!: typeof import("@/lib/inbox/conversation-actions")
  let guard!: typeof import("@/lib/inbox/whatsapp-ai-reply-guard")
  let booking!: typeof import("@/lib/booking/whatsapp-agent")
  let sweep!: typeof import("@/lib/inbox/autonomous-agent-cron")
  let followup!: typeof import("@/lib/inbox/followup-cron")
  let reminders!: typeof import("@/lib/tasks/task-reminders")
  let createdDb = false
  let createdRole = false

  const inOrg = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithTenant(ORG, fn) as Promise<T>
  const bypass = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithRlsBypass(fn) as Promise<T>

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'inbox-panel-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    // The two columns and the reminder index as production gets them: from their migrations.
    sql(scratch!.adminDb, [
      `ALTER TABLE "social_conversations" DROP COLUMN "autoReplyOffAt", DROP COLUMN "autoReplyOffBy";`,
      `ALTER TABLE "tasks" DROP COLUMN "remindAt", DROP COLUMN "remindedAt";`,
      readFileSync(path.join(ROOT, "prisma/migrations/20261221090000_conversation_auto_reply_switch/migration.sql"), "utf8"),
      readFileSync(path.join(ROOT, "prisma/migrations/20261221091000_task_reminders/migration.sql"), "utf8"),
    ].join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    autoReply = await import("@/lib/inbox/conversation-auto-reply")
    ai = await import("@/lib/social/ai-autoreply")
    keyword = await import("@/lib/chatbot-autoreply")
    actions = await import("@/lib/inbox/conversation-actions")
    guard = await import("@/lib/inbox/whatsapp-ai-reply-guard")
    booking = await import("@/lib/booking/whatsapp-agent")
    sweep = await import("@/lib/inbox/autonomous-agent-cron")
    followup = await import("@/lib/inbox/followup-cron")
    reminders = await import("@/lib/tasks/task-reminders")

    await bypass(async () => {
      await prisma.organization.create({
        data: {
          id: ORG, name: ORG, slug: ORG,
          features: ["aiAutoReply", "chatbotAutoReply", "inboxFollowUp"],
          settings: { bookingWhatsApp: { mode: "book" } },
        },
      })
      await prisma.organization.create({ data: { id: OTHER, name: OTHER, slug: OTHER } })
      for (const [id, name] of [[MANAGER, "Günel"], [AGENT, "Tural"]]) {
        await prisma.user.create({ data: { id, organizationId: ORG, email: `${id}@panel.test`, name, passwordHash: "x", role: "manager" } })
      }
      await prisma.channelConfig.create({ data: { id: CHANNEL, organizationId: ORG, channelType: "instagram", configName: "dukan.az", settings: { replyMode: "ai" } } })
      await prisma.channelConfig.create({ data: { id: WA_CHANNEL, organizationId: ORG, channelType: "whatsapp", configName: "+994 50", settings: {} } })
      await prisma.aiAgentConfig.create({
        data: { organizationId: ORG, configName: "Inbox", agentType: "inbox", isActive: true, autonomousBacklogEnabled: true },
      })
      await prisma.chatbotRule.create({
        data: { organizationId: ORG, name: "Ünvan", status: "active", triggerType: "contains", triggerValue: "ünvan", responseText: "Nizami 54" },
      })
      const conversations: Array<[string, string, string, string | null]> = [
        [OFF, "instagram", "ig-anar", CHANNEL],
        [ON, "instagram", "ig-rena", CHANNEL],
        [WA, "whatsapp", "994501112233", WA_CHANNEL],
        [TT, "tiktok", "tt-kamran", null],
      ]
      for (const [id, platform, externalId, channelConfigId] of conversations) {
        await prisma.socialConversation.create({
          data: { id, organizationId: ORG, platform, externalId, contactName: id, channelConfigId, lastMessageAt: ago(30 * 60 / 60), status: "open" },
        })
        await prisma.channelMessage.create({
          data: {
            id: `in-${id}`, organizationId: ORG, channelConfigId, conversationId: id, direction: "inbound", channelType: platform,
            from: externalId, to: "page", body: "Ünvanınız haradadır?", createdAt: ago(30),
          },
        })
      }
      await prisma.webChatSession.create({ data: { id: WEB_SESSION, organizationId: ORG, visitorName: "Fidan" } })
      await prisma.socialConversation.create({
        data: { id: WEB, organizationId: ORG, platform: "inbox", externalId: `w:${WEB_SESSION}`, contactName: "Fidan", metadata: { channel: "web-chat", webChatSessionId: WEB_SESSION } },
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  beforeEach(() => { outbox.sent.length = 0 })

  const setSwitch = (conversationId: string, on: boolean, organizationId = ORG) =>
    rls.runWithTenant(organizationId, () => autoReply.setConversationAutoReply({ organizationId, conversationId, on, userId: MANAGER }))

  it("switches one conversation off, says who did it, and leaves the one beside it alone", async () => {
    const state = await setSwitch(OFF, false)
    expect(state).toMatchObject({ off: true, offBy: MANAGER })
    // A second press keeps the first person's name.
    await rls.runWithTenant(ORG, () => autoReply.setConversationAutoReply({ organizationId: ORG, conversationId: OFF, on: false, userId: AGENT }))
    const rows: Array<{ id: string; autoReplyOffAt: Date | null; autoReplyOffBy: string | null }> = await inOrg(() => prisma.socialConversation.findMany({ where: { id: { in: [OFF, ON] } }, select: { id: true, autoReplyOffAt: true, autoReplyOffBy: true }, orderBy: { id: "asc" } }))
    expect(rows.find((row) => row.id === OFF)).toMatchObject({ autoReplyOffBy: MANAGER })
    expect(rows.find((row) => row.id === OFF)?.autoReplyOffAt).toBeInstanceOf(Date)
    expect(rows.find((row) => row.id === ON)).toMatchObject({ autoReplyOffAt: null, autoReplyOffBy: null })
    expect(await inOrg(() => autoReply.autoReplyOff(ORG, OFF))).toBe(true)
    expect(await inOrg(() => autoReply.autoReplyOff(ORG, ON))).toBe(false)
  })

  it("does not let another organization switch it", async () => {
    expect(await setSwitch(ON, false, OTHER)).toBeNull()
    expect(await inOrg(() => autoReply.autoReplyOff(ORG, ON))).toBe(false)
  })

  it("refuses the shared AI lease on the off conversation only — and an operator's own send still claims it", async () => {
    const refused = await inOrg(() => ai.claimConversationAiReply({ organizationId: ORG, conversationId: OFF }))
    expect(refused.claimed).toBe(false)
    const operator = await inOrg(() => ai.claimConversationAiReply({ organizationId: ORG, conversationId: OFF, operatorAction: true }))
    expect(operator.claimed).toBe(true)
    if (operator.claimed) await inOrg(() => ai.releaseConversationAiReplyClaim({ organizationId: ORG, conversationId: OFF, token: operator.token }))

    const beside = await inOrg(() => ai.claimConversationAiReply({ organizationId: ORG, conversationId: ON }))
    expect(beside.claimed).toBe(true)
    if (beside.claimed) await inOrg(() => ai.releaseConversationAiReplyClaim({ organizationId: ORG, conversationId: ON, token: beside.token }))
  })

  it("keeps maybeAiAutoReply silent there and says why", async () => {
    const send = vi.fn(async () => true)
    const result = await inOrg(() => ai.maybeAiAutoReply({
      orgId: ORG, channelConfigId: CHANNEL, platform: "instagram", conversationId: OFF, pageId: "page",
      externalId: "ig-anar", userMessage: "Ünvanınız haradadır?", senderName: "Anar", inboundMessageId: `in-${OFF}`, send,
    }))
    expect(result).toEqual({ replied: false, escalated: false, skipped: "auto_reply_off" })
    expect(send).not.toHaveBeenCalled()
  })

  it("keeps the keyword bot silent there, and it still answers the conversation beside it", async () => {
    const off = await inOrg(() => keyword.maybeAutoReply({ orgId: ORG, channelType: "instagram", conversationId: OFF, inboundText: "ünvan?", to: "ig-anar", channelConfigId: CHANNEL }))
    expect(off).toMatchObject({ matched: false, sent: false, skipped: "auto-reply-off" })
    expect(outbox.sent.filter((row) => row.conversationId === OFF)).toEqual([])

    const on = await inOrg(() => keyword.maybeAutoReply({ orgId: ORG, channelType: "instagram", conversationId: ON, inboundText: "ünvan?", to: "ig-rena", channelConfigId: CHANNEL }))
    expect(on.matched).toBe(true)
  })

  it("stops a flow's reply, menu and AI reply there — and lets an operator's bulk-close farewell through", async () => {
    const conversation: { metadata: unknown } = await inOrg(() => prisma.socialConversation.findFirstOrThrow({ where: { id: OFF } }))
    const snapshot = {
      id: OFF, contactId: null, contactName: "Anar", platform: "instagram", externalId: "ig-anar", channelConfigId: CHANNEL,
      lastMessage: "Ünvanınız haradadır?", status: "open", assignedTo: null, metadata: conversation.metadata as Record<string, unknown>,
    }
    const flow = { organizationId: ORG, conversationId: OFF, conversation: snapshot, actorUserId: null, deliveryOperationId: "run-1:node-1" }
    for (const action of [
      { type: "send_reply" as const, config: { text: "Salam!" } },
      { type: "menu" as const, config: { prompt: "Seçin:", options: [{ id: "a", label: "Ünvan" }] } },
      { type: "ai_reply" as const, config: {} },
    ]) {
      const result = await inOrg(() => actions.executeConversationAction(action, flow))
      expect(result).toMatchObject({ ok: false, error: "auto_reply_off" })
    }
    expect(outbox.sent).toEqual([])

    const farewell = await inOrg(() => actions.executeConversationAction(
      { type: "send_reply", config: { text: "Sağ olun!" } },
      { organizationId: ORG, conversationId: OFF, conversation: snapshot, actorUserId: MANAGER },
    ))
    expect(farewell.ok).toBe(true)
    expect(outbox.sent).toEqual([{ conversationId: OFF, body: "Sağ olun!" }])
  })

  it("keeps WhatsApp Da Vinci and the booking bot away from an off WhatsApp conversation", async () => {
    await setSwitch(WA, false)
    const operation = vi.fn(async () => undefined)
    await inOrg(() => guard.withWhatsAppAiReplyGuard(ORG, WA, operation))
    expect(operation).not.toHaveBeenCalled()

    const model = { messages: { create: vi.fn(async () => { throw new Error("the model was asked") }) } }
    const turn = await inOrg(() => booking.handleWhatsAppBookingTurn({
      organizationId: ORG, channelConfigId: WA_CHANNEL, conversationId: WA, waPhone: "994501112233",
      senderName: "Kamran", text: "Sabah saat 11-ə yazılmaq istəyirəm", replyId: null,
      client: model as unknown as NonNullable<Parameters<typeof booking.handleWhatsAppBookingTurn>[0]["client"]>,
    }))
    expect(turn).toEqual({ handled: false })
    expect(model.messages.create).not.toHaveBeenCalled()
    expect(outbox.sent).toEqual([])
  })

  it("loses the send when the switch goes off while the reply is being written", async () => {
    await setSwitch(WA, true)
    let sentAfterSwitch: boolean | null = null
    await inOrg(() => guard.withWhatsAppAiReplyGuard(ORG, WA, async (stillOwned) => {
      // The model is writing; a manager presses «AI rejimi».
      await setSwitch(WA, false)
      sentAfterSwitch = await stillOwned()
    }))
    expect(sentAfterSwitch).toBe(false)
  })

  it("leaves the off conversation out of the backlog sweep and answers the one beside it", async () => {
    const reply = vi.fn(async (_input: { conversationId: string }) => ({ replied: true, escalated: false }))
    const run = await bypass(() => sweep.runAutonomousInboxAgent(prisma, { now: NOW, reply, businessOpen: async () => true }))
    const asked = reply.mock.calls.map(([input]) => input.conversationId)
    expect(asked).toContain(ON)
    expect(asked).not.toContain(OFF)
    expect(run.replied).toBeGreaterThanOrEqual(1)
  })

  it("does not send the TikTok nudge to an off conversation, and nudges the one beside it", async () => {
    // 10:00 in Baku — inside the nudge's daytime window; both customers went quiet after our reply a day ago.
    const daytime = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate(), 6, 0, 0))
    const dayAgo = new Date(daytime.getTime() - 25 * 3600_000)
    await bypass(async () => {
      // The customer's question came before our answer, so our answer is the last word.
      await prisma.channelMessage.update({ where: { id: `in-${TT}` }, data: { createdAt: new Date(dayAgo.getTime() - 3600_000) } })
      for (const [id, externalId] of [[TT, "tt-kamran"], ["conv-tt-on", "tt-nigar"]]) {
        if (id !== TT) {
          await prisma.socialConversation.create({ data: { id, organizationId: ORG, platform: "tiktok", externalId, contactName: id, status: "open" } })
        }
        await prisma.socialConversation.update({ where: { id }, data: { lastMessageAt: dayAgo } })
        await prisma.channelMessage.create({
          data: { organizationId: ORG, conversationId: id, direction: "outbound", channelType: "tiktok", from: "page", to: externalId, body: "Bəli, var.", createdAt: dayAgo },
        })
      }
    })
    await setSwitch(TT, false)
    const send = vi.fn(async (_input: { conversationId: string }) => true as const)
    await bypass(() => followup.runInboxFollowups(prisma, { now: daytime, send }))
    expect(send.mock.calls.map(([input]) => input.conversationId)).toEqual(["tt-nigar"])
    const row: { followUpSentAt: Date | null } = await bypass(() => prisma.socialConversation.findUniqueOrThrow({ where: { id: TT }, select: { followUpSentAt: true } }))
    expect(row.followUpSentAt).toBeNull()
  })

  it("pauses the website chat with the switch, and back on pauses it only while a person holds it", async () => {
    await setSwitch(WEB, false)
    const pausedOf = async (): Promise<boolean> => {
      const session: { aiPaused: boolean } = await bypass(() => prisma.webChatSession.findUniqueOrThrow({ where: { id: WEB_SESSION }, select: { aiPaused: true } }))
      return session.aiPaused
    }
    const paused = { aiPaused: await pausedOf() }
    expect(paused.aiPaused).toBe(true)

    await setSwitch(WEB, true)
    expect(await pausedOf()).toBe(false)

    await bypass(() => prisma.webChatSession.update({ where: { id: WEB_SESSION }, data: { assignedUserId: AGENT } }))
    await setSwitch(WEB, false)
    await setSwitch(WEB, true)
    expect(await pausedOf()).toBe(true)
  })

  it("answers again once the switch is back on", async () => {
    await setSwitch(OFF, true)
    const claim = await inOrg(() => ai.claimConversationAiReply({ organizationId: ORG, conversationId: OFF }))
    expect(claim.claimed).toBe(true)
    if (claim.claimed) await inOrg(() => ai.releaseConversationAiReplyClaim({ organizationId: ORG, conversationId: OFF, token: claim.token }))
  })

  it("rings a reminder once, in its assignee's bell, and keeps a finished task quiet", async () => {
    await bypass(async () => {
      await prisma.task.create({ data: { id: "task-due", organizationId: ORG, title: "Anar bəy gəlir — çəkmə hazır olsun", assignedTo: AGENT, dueDate: ago(1), remindAt: ago(1), relatedType: "contact", relatedId: "contact-anar" } })
      await prisma.task.create({ data: { id: "task-later", organizationId: ORG, title: "Sabah zəng", assignedTo: AGENT, remindAt: new Date(NOW.getTime() + 3600_000) } })
      await prisma.task.create({ data: { id: "task-done", organizationId: ORG, title: "Artıq edildi", assignedTo: AGENT, remindAt: ago(2), status: "done", completedAt: ago(3) } })
      await prisma.task.create({ data: { id: "task-gone", organizationId: ORG, title: "Silinib", assignedTo: AGENT, remindAt: ago(2), deletedAt: ago(1) } })
    })

    const first = await bypass(() => reminders.runTaskReminders(NOW))
    const second = await bypass(() => reminders.runTaskReminders(NOW))
    expect(first).toMatchObject({ reminded: 1, skipped: 1 })
    expect(second).toMatchObject({ reminded: 0 })

    const bell = await bypass(() => prisma.notification.findMany({ where: { organizationId: ORG, entityType: "task" }, select: { userId: true, entityId: true, title: true, message: true } }))
    expect(bell).toEqual([{ userId: AGENT, entityId: "task-due", title: expect.any(String), message: "Anar bəy gəlir — çəkmə hazır olsun" }])

    // Raw: the client hides soft-deleted tasks, and the deleted one is part of what is checked.
    const stamped: Array<{ id: string; remindedAt: Date | null }> = await bypass(() => prisma.$queryRaw<Array<{ id: string; remindedAt: Date | null }>>`
      SELECT id, "remindedAt" FROM tasks WHERE "organizationId" = ${ORG} ORDER BY id`)
    expect(Object.fromEntries(stamped.map((row) => [row.id, row.remindedAt !== null]))).toEqual({
      "task-done": true, // finished: stamped, nobody told
      "task-due": true,
      "task-gone": false, // deleted: never read
      "task-later": false, // not yet
    })
  })
})
