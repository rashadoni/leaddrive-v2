import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ channelConfig: { findFirst: vi.fn(), updateMany: vi.fn() }, socialConversation: { findFirst: vi.fn() }, channelPreference: { findFirst: vi.fn() } }))
const guard = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/inbox/whatsapp-ai-reply-guard", () => ({ withWhatsAppAiReplyGuard: guard }))
import { aiTestView, claimWhatsAppAiTest, hasWhatsAppAiTest, normalizeAiTestPhone, readWhatsAppAiTest, startWhatsAppAiTest, stillInWhatsAppAiTest, stopWhatsAppAiTest, withWhatsAppAiPolicy } from "@/lib/inbox/whatsapp-ai-test"

const binding = { organizationId: "org", channelConfigId: "channel", conversationId: "owner-conv", phone: "+15550001001" }
let settings: { replyMode: string; draftMode: boolean; unrelatedSetting: unknown; whatsappAiTest?: ReturnType<typeof run> }
let conversation: { externalId: string; status: string; assignedTo: string | null; metadata: { whatsappOptedOut?: boolean }; contactId: string } | null
let preference: { isOptedIn: boolean } | null
function run() { return { runId: "run", conversationId: binding.conversationId, recipientPhone: "15550001001", expiresAt: new Date(Date.now() + 60_000).toISOString(), maxAttempts: 3, attemptsUsed: 0 } }
function arm() { settings.whatsappAiTest = run() }
beforeEach(() => {
  vi.resetAllMocks()
  settings = { replyMode: "agent", draftMode: false, unrelatedSetting: { keep: true } }
  conversation = { externalId: "15550001001", status: "open", assignedTo: null, metadata: {}, contactId: "contact" }
  preference = null
  db.channelConfig.findFirst.mockImplementation(async ({ where }) => where.id === binding.channelConfigId && where.organizationId === binding.organizationId && where.channelType === "whatsapp" && where.isActive === true ? { settings: structuredClone(settings) } : null)
  db.channelConfig.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id !== binding.channelConfigId || where.organizationId !== binding.organizationId || JSON.stringify(where.settings.equals) !== JSON.stringify(settings)) return { count: 0 }
    settings = structuredClone(data.settings)
    return { count: 1 }
  })
  db.socialConversation.findFirst.mockImplementation(async ({ where }) => where.id === binding.conversationId && where.organizationId === binding.organizationId && where.channelConfigId === binding.channelConfigId && where.platform === "whatsapp" && where.deletedAt === null ? conversation : null)
  db.channelPreference.findFirst.mockImplementation(async () => preference)
  guard.mockImplementation(async (_org, _conv, operation) => operation(async () => true))
})

describe("recipient-bound WhatsApp AI test", () => {
  it.each(["15550001001", "+1 (555) 000-1001"])("accepts only a full international phone: %s", (phone) => expect(normalizeAiTestPhone(phone)).toBe("15550001001"))
  it.each(["15550001001@wa", "555", "x15550001001", "0015550001001"])("rejects malformed identifiers: %s", (phone) => expect(normalizeAiTestPhone(phone)).toBeNull())
  it("arms only the existing conversation; preserves manual mode and all other settings; masks phone in the response", async () => {
    const view = await startWhatsAppAiTest(binding)
    expect(settings.replyMode).toBe("agent")
    expect(settings.unrelatedSetting).toEqual({ keep: true })
    expect(view).toMatchObject({ recipientLast4: "1001", attemptsUsed: 0, maxAttempts: 3, active: true })
    expect(Date.parse(view!.expiresAt) - Date.now()).toBeGreaterThan(19 * 60_000)
    expect(JSON.stringify(view)).not.toContain("15550001001")
  })
  it.each(["organizationId", "channelConfigId", "conversationId", "phone"])("rejects a different %s at start and claim", async (key) => {
    arm()
    const foreign = { ...binding, [key]: key === "phone" ? "+15550001002" : "other" }
    await expect(startWhatsAppAiTest(foreign)).rejects.toThrow()
    expect(await claimWhatsAppAiTest(foreign)).toBeNull()
    expect(settings.whatsappAiTest!.attemptsUsed).toBe(0)
  })
  it.each(["assigned", "closed", "metadata-opt-out", "preference-opt-out", "missing", "wrong-phone"])("blocks an ineligible conversation: %s", async (state) => {
    arm()
    if (state === "assigned") conversation!.assignedTo = "human"
    if (state === "closed") conversation!.status = "closed"
    if (state === "metadata-opt-out") conversation!.metadata.whatsappOptedOut = true
    if (state === "preference-opt-out") preference = { isOptedIn: false }
    if (state === "missing") conversation = null
    if (state === "wrong-phone") conversation!.externalId = "15550001002"
    await expect(startWhatsAppAiTest(binding)).rejects.toThrow()
    expect(await claimWhatsAppAiTest(binding)).toBeNull()
  })
  it("refuses to activate while channel-wide AI is enabled or a test is already running", async () => {
    settings.replyMode = "ai"
    await expect(startWhatsAppAiTest(binding)).rejects.toThrow("agent mode")
    settings.replyMode = "agent"
    arm()
    await expect(startWhatsAppAiTest(binding)).rejects.toThrow("already active")
  })
  it("fails closed on malformed, expired and exhausted runs even with channel-wide AI enabled", async () => {
    for (const value of [null, {}, { ...run(), maxAttempts: 4 }, { ...run(), expiresAt: "bad" }, { ...run(), expiresAt: new Date(0).toISOString() }, { ...run(), attemptsUsed: 3 }]) {
      settings.whatsappAiTest = value as ReturnType<typeof run>
      settings.replyMode = "ai"
      const operation = vi.fn()
      await withWhatsAppAiPolicy(binding, settings, operation)
      expect(operation).not.toHaveBeenCalled()
    }
    expect(hasWhatsAppAiTest(settings)).toBe(true)
  })
  it("limits concurrent allocations to at most three; never refunds failed generation", async () => {
    arm()
    const claims = await Promise.all(Array.from({ length: 15 }, () => claimWhatsAppAiTest(binding)))
    expect(claims.filter(Boolean)).toHaveLength(3)
    expect(new Set(claims.filter(Boolean).map(c => c!.claimId)).size).toBe(3)
    expect(settings.whatsappAiTest!.attemptsUsed).toBe(3)
    expect(await claimWhatsAppAiTest(binding)).toBeNull()
    expect(aiTestView(settings)?.active).toBe(false)
    expect(settings.unrelatedSetting).toEqual({ keep: true })
  })
  it("does not overwrite a concurrent settings change when starting or stopping", async () => {
    db.channelConfig.updateMany.mockImplementation(async () => { settings.unrelatedSetting = "concurrent"; return { count: 0 } })
    await expect(startWhatsAppAiTest(binding)).rejects.toThrow("changed")
    expect(settings.unrelatedSetting).toBe("concurrent")
    arm()
    await expect(stopWhatsAppAiTest(binding)).rejects.toThrow("changed")
    expect(settings.whatsappAiTest).toBeTruthy()
  })
  it.each(["stop", "expiry", "STOP", "human", "mode-change", "new-claim"])("blocks an in-flight send after %s", async (change) => {
    arm()
    const claim = (await claimWhatsAppAiTest(binding))!
    expect(await stillInWhatsAppAiTest(binding, claim)).toBe(true)
    if (change === "stop") await stopWhatsAppAiTest(binding)
    if (change === "expiry") settings.whatsappAiTest!.expiresAt = new Date(0).toISOString()
    if (change === "STOP") preference = { isOptedIn: false }
    if (change === "human") conversation!.assignedTo = "human"
    if (change === "mode-change") settings.replyMode = "ai"
    if (change === "new-claim") await claimWhatsAppAiTest(binding)
    expect(await stillInWhatsAppAiTest(binding, claim)).toBe(false)
  })
  it("stopping removes only the test and retains explicit manual mode", async () => {
    arm()
    await stopWhatsAppAiTest(binding)
    await stopWhatsAppAiTest(binding)
    expect(settings).toEqual({ replyMode: "agent", draftMode: false, unrelatedSetting: { keep: true } })
    expect(readWhatsAppAiTest(settings)).toBeNull()
  })
  it("routes only the owner to native AI, tracks the run and rechecks before send", async () => {
    arm()
    const generate = vi.fn(async (allowed, runId) => {
      expect(runId).toBe("run")
      await stopWhatsAppAiTest(binding)
      if (await allowed()) throw new Error("sending after stop")
    })
    await withWhatsAppAiPolicy({ ...binding, phone: "+15550001002" }, settings, generate)
    await withWhatsAppAiPolicy({ ...binding, conversationId: "client" }, settings, generate)
    expect(generate).not.toHaveBeenCalled()
    await withWhatsAppAiPolicy(binding, settings, generate)
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it("rechecks fresh DB settings even when webhook has a stale test snapshot", async () => {
    arm()
    const stale = structuredClone(settings)
    await stopWhatsAppAiTest(binding)
    const generate = vi.fn()
    await withWhatsAppAiPolicy(binding, stale, generate)
    expect(generate).not.toHaveBeenCalled()
  })
  it("preserves legacy policy when the test key is absent", async () => {
    const operation = vi.fn()
    await withWhatsAppAiPolicy(binding, { replyMode: "agent" }, operation)
    expect(operation).not.toHaveBeenCalled()
    await withWhatsAppAiPolicy(binding, { replyMode: "ai" }, operation)
    await withWhatsAppAiPolicy(binding, {}, operation)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(operation.mock.calls[0][1]).toBeUndefined()
  })
})
