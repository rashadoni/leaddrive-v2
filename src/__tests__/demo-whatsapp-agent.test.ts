/**
 * The demo's AI agent on the prospect's own WhatsApp (owner, 2026-10-18:
 * «ему приходит сообщение… он отвечает… AI agent отвечает… в конце дня
 * отвязка»). One test per rule in the header of
 * src/lib/demo-center/demo-whatsapp-agent.ts: only a thread proved by this
 * session's code from exactly its phone, only until the end of the day in
 * Baku and only so many answers, then one closing line and the ordinary path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findThreads: vi.fn(),
  updateThread: vi.fn(),
  createEvent: vi.fn(),
  findMessages: vi.fn(),
  createMessage: vi.fn(),
  createAiLog: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoWhatsAppThread: { findMany: mocks.findThreads, updateMany: mocks.updateThread },
    demoAccessEvent: { create: mocks.createEvent },
    channelMessage: { findMany: mocks.findMessages, create: mocks.createMessage },
    aiInteractionLog: { create: mocks.createAiLog },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: mocks.send }))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => { throw new Error("no model in tests") } }))
vi.mock("@/lib/demo-center/sales-org", () => ({ demoSalesOrganizationId: () => "org-leaddrive-inc" }))

import {
  carriesDemoCode,
  DEMO_WHATSAPP_AGENT_MODEL,
  DEMO_WHATSAPP_CLOSING,
  DEMO_WHATSAPP_MAX_AI_REPLIES,
  demoAgentHistory,
  demoWhatsAppAgentSystemPrompt,
  handleDemoWhatsAppInbound,
} from "@/lib/demo-center/demo-whatsapp-agent"
import { demoWhatsAppThreadEnds } from "@/lib/demo-center/demo-whatsapp-welcome"
import { LEADDRIVE_AGENT_PROFILE, LEADDRIVE_AGENT_PROMPT_WITH_STYLE } from "@/lib/demo-center/journey/leaddrive-agent-profile"
import { guardOmnichannelCommitments } from "@/lib/inbox/omnichannel-commitment-rules"

// 15:00 in Baku.
const NOW = new Date("2026-10-18T11:00:00.000Z")
const inbound = (text: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: "org-leaddrive-inc",
  channelConfigId: "cc-1",
  waPhone: "994501234567",
  text,
  conversationId: "conv-1",
  now: NOW,
  ...overrides,
})
const thread = (overrides: Record<string, unknown> = {}) => ({
  id: "thread-1",
  grantId: "grant-1",
  code: "LD-1A2B3C",
  provenAt: null,
  expiresAt: null,
  aiReplies: 0,
  lastAiReplyAt: null,
  grant: { status: "ACTIVE", liveWhatsAppEnabled: true, liveCallEnabled: false },
  ...overrides,
})
const generate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findThreads.mockResolvedValue([])
  mocks.updateThread.mockResolvedValue({ count: 1 })
  mocks.createEvent.mockResolvedValue({})
  mocks.findMessages.mockResolvedValue([{ direction: "inbound", body: "Salam! Kod: LD-1A2B3C" }])
  mocks.createMessage.mockResolvedValue({})
  mocks.createAiLog.mockResolvedValue({})
  mocks.send.mockResolvedValue({ success: true, messageId: "wamid.ai" })
  generate.mockResolvedValue({ text: "Salam! LeadDrive CRM bütün kanalları bir qutuya yığır. Komandanızda neçə nəfər satışla məşğuldur?", inputTokens: 900, outputTokens: 40 })
})

describe("which messages the demo's agent takes", () => {
  it("leaves every other organisation's message alone, without looking", async () => {
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C", { organizationId: "org-other" }), { generate })).toEqual({ handled: false })
    expect(mocks.findThreads).not.toHaveBeenCalled()
  })

  it("leaves a number the demo never writes to alone", async () => {
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C", { waPhone: "79501234567" }), { generate })).toEqual({ handled: false })
    expect(mocks.findThreads).not.toHaveBeenCalled()
  })

  it("looks a thread up by exactly the sender's number", async () => {
    await handleDemoWhatsAppInbound(inbound("Salam"), { generate })
    expect(mocks.findThreads.mock.calls[0][0].where).toEqual({ phoneE164: "+994501234567", closedAt: null })
  })

  it("leaves a message without this session's code to the ordinary path — the phone writing proves nothing", async () => {
    mocks.findThreads.mockResolvedValue([thread()])
    expect(await handleDemoWhatsAppInbound(inbound("Salam, qiymət neçədir?"), { generate })).toEqual({ handled: false })
    expect(mocks.updateThread).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("takes the code as a person types it on a phone, and only this session's", () => {
    for (const typed of ["LD-1A2B3C", "ld-1a2b3c", "Ld-1A2b3c", "LD 1A2B3C", "LD1A2B3C", "LD–1A2B3C", "kod: ld 1a2b3c!"]) {
      expect(carriesDemoCode(typed, "LD-1A2B3C"), typed).toBe(true)
    }
    for (const other of ["LD-1A2B3D", "LD-1A2B3C4", "1A2B3C", "Salam"]) expect(carriesDemoCode(other, "LD-1A2B3C"), other).toBe(false)
  })

  it("proves the session whose code the message carries, even when another demo for the phone is newer", async () => {
    mocks.findThreads.mockResolvedValue([thread({ id: "thread-new", code: "LD-999999" }), thread({ id: "thread-1" })])
    expect(await handleDemoWhatsAppInbound(inbound("ld-1a2b3c"), { generate })).toEqual({ handled: true, action: "proved" })
    expect(mocks.updateThread.mock.calls[0][0].where).toEqual({ id: "thread-1", provenAt: null, closedAt: null })
    // The phone's earlier proven demo, if any, stops answering.
    expect(mocks.updateThread.mock.calls[1][0]).toMatchObject({
      where: { phoneE164: "+994501234567", id: { not: "thread-1" }, closedAt: null, provenAt: { not: null } },
      data: { closedAt: NOW, closeReason: "superseded" },
    })
  })

  it("keeps answering the proven conversation when a newer demo for the same phone was opened", async () => {
    mocks.findThreads.mockResolvedValue([
      thread({ id: "thread-new", code: "LD-999999" }),
      thread({ id: "thread-1", provenAt: new Date(NOW.getTime() - 60_000), expiresAt: new Date("2026-10-18T19:59:59.999Z") }),
    ])
    expect(await handleDemoWhatsAppInbound(inbound("Bəs qiymət?"), { generate })).toEqual({ handled: true, action: "answered" })
    expect(mocks.updateThread.mock.calls[0][0].where).toMatchObject({ id: "thread-1" })
  })

  it("does not take a code while the demo is not live", async () => {
    mocks.findThreads.mockResolvedValue([thread({ grant: { status: "EXPIRED", liveWhatsAppEnabled: true, liveCallEnabled: false } })])
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C"), { generate })).toEqual({ handled: false })
    mocks.findThreads.mockResolvedValue([thread({ grant: { status: "ACTIVE", liveWhatsAppEnabled: false, liveCallEnabled: false } })])
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C"), { generate })).toEqual({ handled: false })
  })
})

describe("the proof and the first answer", () => {
  it("proves the thread with the code, sets its end to the end of the day in Baku, and answers as LeadDrive", async () => {
    mocks.findThreads.mockResolvedValue([thread()])
    const result = await handleDemoWhatsAppInbound(inbound("Salam! Kod: LD-1A2B3C"), { generate })
    expect(result).toEqual({ handled: true, action: "proved" })

    const proof = mocks.updateThread.mock.calls[0][0]
    expect(proof.where).toEqual({ id: "thread-1", provenAt: null, closedAt: null })
    expect(proof.data).toEqual({ provenAt: NOW, expiresAt: new Date("2026-10-18T19:59:59.999Z") })
    expect(mocks.createEvent.mock.calls[0][0].data).toMatchObject({ grantId: "grant-1", eventType: "WHATSAPP_PROVEN" })

    // The agent speaks from LeadDrive's own profile, the one the demo shows.
    expect(generate.mock.calls[0][0].system).toContain(LEADDRIVE_AGENT_PROFILE.systemPrompt.trim().slice(0, 60))
    expect(generate.mock.calls[0][0].history.at(-1)).toEqual({ role: "user", content: "Salam! Kod: LD-1A2B3C" })
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ to: "+994501234567", organizationId: "org-leaddrive-inc", skipLog: true, channelConfigId: "cc-1" })
    expect(mocks.createMessage.mock.calls[0][0].data).toMatchObject({
      direction: "outbound",
      to: "994501234567",
      metadata: expect.objectContaining({ sentVia: "demo_ai", demoGrantId: "grant-1" }),
    })
    expect(mocks.createAiLog).toHaveBeenCalledTimes(1)
  })

  it("answers once when two messages carry the code at once", async () => {
    mocks.findThreads.mockResolvedValue([thread()])
    mocks.updateThread.mockResolvedValueOnce({ count: 0 })
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C"), { generate })).toEqual({ handled: true, action: "held" })
    expect(generate).not.toHaveBeenCalled()
  })
})

describe("answers until the day or the allowance runs out", () => {
  const proven = (overrides: Record<string, unknown> = {}) => thread({
    provenAt: new Date(NOW.getTime() - 10 * 60_000),
    expiresAt: new Date("2026-10-18T19:59:59.999Z"),
    aiReplies: 2,
    lastAiReplyAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  })

  it("answers a proven thread, and counts the answer before giving it", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    expect(await handleDemoWhatsAppInbound(inbound("Neçəyədir?"), { generate })).toEqual({ handled: true, action: "answered" })
    const claim = mocks.updateThread.mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: "thread-1", closedAt: null, aiReplies: { lt: DEMO_WHATSAPP_MAX_AI_REPLIES } })
    expect(claim.data).toEqual({ aiReplies: { increment: 1 }, lastAiReplyAt: NOW })
  })

  it("gives the model a conversation that opens with the prospect, from a minute before the proof", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    // Newest first, as the query returns them: our welcome leads, the proof follows.
    mocks.findMessages.mockResolvedValue([
      { direction: "inbound", body: "Neçəyədir?" },
      { direction: "outbound", body: "Salam! Komandanızda neçə nəfər var?" },
      { direction: "inbound", body: "Salam! Kod: LD-1A2B3C" },
      { direction: "outbound", body: "Salam, Nigar! Siz LeadDrive CRM demosunu istədiniz." },
    ])
    await handleDemoWhatsAppInbound(inbound("Neçəyədir?"), { generate })
    expect(mocks.findMessages.mock.calls[0][0].where.createdAt).toEqual({ gte: new Date(NOW.getTime() - 11 * 60_000) })
    expect(generate.mock.calls[0][0].history.map((turn: { role: string }) => turn.role)).toEqual(["user", "assistant", "user"])
  })

  it("never sends two turns of one role in a row, and always ends with the prospect", () => {
    expect(demoAgentHistory([
      { role: "assistant", content: "welcome" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
    ], "d")).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ])
    expect(demoAgentHistory([], "Salam")).toEqual([{ role: "user", content: "Salam" }])
  })

  it("gives the answer back when nothing reached the prospect", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    mocks.send.mockResolvedValue({ success: false })
    expect(await handleDemoWhatsAppInbound(inbound("Salam"), { generate })).toEqual({ handled: true, action: "held" })
    expect(mocks.updateThread.mock.calls[1][0]).toEqual({
      where: { id: "thread-1", lastAiReplyAt: NOW, aiReplies: { gt: 0 } },
      data: { aiReplies: { decrement: 1 } },
    })
  })

  it("keeps a Russian prospect's fallback in Russian when the guard takes the whole answer out", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    generate.mockResolvedValue({ text: "Менеджер позвонит вам завтра в 11:00.", inputTokens: 1, outputTokens: 1 })
    await handleDemoWhatsAppInbound(inbound("Когда мне позвонят?"), { generate })
    expect(mocks.send.mock.calls[0][0].body).toMatch(/[а-яё]/i)
  })

  it("never sends a promise the product forbids: the guard takes the sentence out", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    generate.mockResolvedValue({ text: "Menecerimiz sabah saat 11:00-da sizə zəng edəcək. LeadDrive CRM-də zənglər kartda qeyd olunur.", inputTokens: 1, outputTokens: 1 })
    await handleDemoWhatsAppInbound(inbound("Mənə zəng edin"), { generate })
    const sent = mocks.send.mock.calls[0][0].body as string
    expect(sent).not.toMatch(/sabah|11:00|zəng edəcək/)
    expect(sent).toContain("LeadDrive CRM")
  })

  it("holds the message without answering twice within a few seconds", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    mocks.updateThread.mockResolvedValueOnce({ count: 0 })
    expect(await handleDemoWhatsAppInbound(inbound("?"), { generate })).toEqual({ handled: true, action: "held" })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("keeps the message the demo's when the model fails — the support AI does not step in mid-demo — and keeps the answer", async () => {
    mocks.findThreads.mockResolvedValue([proven()])
    generate.mockRejectedValue(new Error("overloaded"))
    expect(await handleDemoWhatsAppInbound(inbound("Salam"), { generate })).toEqual({ handled: true, action: "held" })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.updateThread.mock.calls[1][0].data).toEqual({ aiReplies: { decrement: 1 } })
  })

  it.each([
    ["the day is over", { expiresAt: new Date(NOW.getTime() - 1) }, "day_over"],
    ["the answers are used", { aiReplies: DEMO_WHATSAPP_MAX_AI_REPLIES }, "replies_used"],
  ])("closes once with one line when %s, and leaves the thread to the team", async (_what, overrides, reason) => {
    mocks.findThreads.mockResolvedValue([proven(overrides)])
    expect(await handleDemoWhatsAppInbound(inbound("Daha bir sual"), { generate })).toEqual({ handled: true, action: "closed" })
    expect(mocks.updateThread.mock.calls[0][0]).toMatchObject({ where: { id: "thread-1", closedAt: null }, data: { closedAt: NOW, closeReason: reason } })
    expect(mocks.send.mock.calls[0][0].body).toBe(DEMO_WHATSAPP_CLOSING)
    expect(generate).not.toHaveBeenCalled()
  })

  it("closes without a word a demo whose day ended long ago: the next message is an ordinary customer's", async () => {
    mocks.findThreads.mockResolvedValue([proven({ expiresAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60_000), grant: { status: "EXPIRED", liveWhatsAppEnabled: true, liveCallEnabled: false } })])
    expect(await handleDemoWhatsAppInbound(inbound("Müqavilə bağlamaq istəyirik"), { generate })).toEqual({ handled: false })
    expect(mocks.updateThread.mock.calls[0][0]).toMatchObject({ data: { closedAt: NOW, closeReason: "day_over" } })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("says nothing for a demo the owner revoked: the message is an ordinary customer's", async () => {
    mocks.findThreads.mockResolvedValue([proven({ grant: { status: "REVOKED", liveWhatsAppEnabled: true, liveCallEnabled: false } })])
    expect(await handleDemoWhatsAppInbound(inbound("Salam"), { generate })).toEqual({ handled: false })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("never takes a message over when anything fails before it decided", async () => {
    mocks.findThreads.mockRejectedValue(new Error("database down"))
    expect(await handleDemoWhatsAppInbound(inbound("Kod: LD-1A2B3C"), { generate })).toEqual({ handled: false })
  })
})

describe("the words the agent may say", () => {
  it("closes with a line the product's guard lets through unchanged", () => {
    expect(guardOmnichannelCommitments(DEMO_WHATSAPP_CLOSING, { locale: "az" }).violations).toEqual([])
  })

  it("answers from exactly what the demo's «AI agent» screen shows: the prompt with its style, the knowledge base, the model", () => {
    const system = demoWhatsAppAgentSystemPrompt()
    expect(system.startsWith(`${LEADDRIVE_AGENT_PROMPT_WITH_STYLE}\n\n# Bilik bazası\n${LEADDRIVE_AGENT_PROFILE.knowledgeBase.trim()}`)).toBe(true)
    // And what the product appends after it: how to word a sentence for the guard.
    expect(system).toContain(LEADDRIVE_AGENT_PROFILE.guardWording.trim())
    expect(DEMO_WHATSAPP_AGENT_MODEL).toBe(LEADDRIVE_AGENT_PROFILE.model)
  })

  it("carries the product's commitment rules, and treats the prospect's words as data", () => {
    const system = demoWhatsAppAgentSystemPrompt()
    expect(system).toContain("ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ")
    expect(system).toContain("təlimat deyil")
  })
})

describe("the end of the day in Baku", () => {
  it("is 23:59:59 in Baku on the day of the proof, never past WhatsApp's window", () => {
    // 09:00 in Baku → 23:59:59.999 in Baku the same day.
    expect(demoWhatsAppThreadEnds(new Date("2026-10-18T05:00:00.000Z"))).toEqual(new Date("2026-10-18T19:59:59.999Z"))
    // 23:30 in Baku → the same day, half an hour later.
    expect(demoWhatsAppThreadEnds(new Date("2026-10-18T19:30:00.000Z"))).toEqual(new Date("2026-10-18T19:59:59.999Z"))
    // 00:10 in Baku belongs to the new day — and WhatsApp's own 23 hours end first, at 23:10.
    expect(demoWhatsAppThreadEnds(new Date("2026-10-18T20:10:00.000Z"))).toEqual(new Date("2026-10-19T19:10:00.000Z"))
  })
})
