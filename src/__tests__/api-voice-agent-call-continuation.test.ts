/**
 * Continuation context — the one endpoint that hands customer speech to the PBX.
 *
 * Its sibling, call-source, deliberately returns nothing free-text so a stolen
 * runtime token yields nothing about anybody. This one has to return the tail of
 * a real conversation, so each of its four fences gets a test that proves the
 * endpoint stays silent when the fence says it should.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findMessages: vi.fn(),
  findConfigs: vi.fn(),
  findLead: vi.fn(),
  createEvents: vi.fn(),
}))

// The number -> organization lookup is its own suite (voice-line-numbers-postgres);
// here every call belongs to the installation's default organization, as before it.
vi.mock("@/lib/voip/line-numbers", () => ({
  voiceOrganizationFor: async () => process.env.VOICE_AGENT_ORGANIZATION_ID
    ? { organizationId: process.env.VOICE_AGENT_ORGANIZATION_ID, channelConfigId: null } : null,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    channelMessage: { findMany: mocks.findMessages },
    channelConfig: { findMany: mocks.findConfigs },
    lead: { findFirst: mocks.findLead },
    callEvent: { createMany: mocks.createEvents },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))

import { GET, trimTranscriptTail } from "@/app/api/internal/voice-agent/call-continuation/route"
import { DEFAULT_INBOUND_GREETING, INBOUND_CALL_CONTEXT } from "@/lib/voip/inbound-answer"

const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrg = process.env.VOICE_AGENT_ORGANIZATION_ID
const callId = "5f1a3b0c-2d4e-4a6b-8c9d-0e1f2a3b4c5d"

const TRANSCRIPT = [
  "AI operator: Salam, necəsiniz?",
  "Müştəri: Yaxşı, qiymət neçədir?",
  "AI operator: Üç yüz manatdır.",
].join("\n")

function request(id: string = callId, token = "runtime-token", query = "") {
  return new NextRequest(
    `http://localhost/api/internal/voice-agent/call-continuation?callId=${id}${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
}

/** A callback whose original call ended a minute ago. */
function callbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-log-callback",
    continuesCallId: "call-log-original",
    continuationServedAt: null,
    leadId: null,
    callMode: "ai",
    ...overrides,
  }
}

function originalRow(overrides: Record<string, unknown> = {}) {
  return {
    transcription: TRANSCRIPT,
    endedAt: new Date(Date.now() - 60_000),
    ...overrides,
  }
}

beforeEach(() => {
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-test"
  mocks.findFirst.mockReset()
  mocks.updateMany.mockReset()
  mocks.findMessages.mockReset()
  mocks.findMessages.mockResolvedValue([])
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.findConfigs.mockReset()
  mocks.findConfigs.mockResolvedValue([])
})

afterEach(() => {
  process.env.FANUM_VOICE_RUNTIME_TOKEN = originalToken
  process.env.VOICE_AGENT_ORGANIZATION_ID = originalOrg
})

describe("GET /api/internal/voice-agent/call-continuation", () => {
  it("rejects a request without the runtime token", async () => {
    const response = await GET(request(callId, "wrong-token"))
    expect(response.status).toBe(401)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it("returns the tail of the conversation for a callback", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(callbackRow())
      .mockResolvedValueOnce(originalRow())

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ continuation: TRANSCRIPT, conversation: null })
  })

  it("stamps the first collection so the grace period starts there", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(callbackRow())
      .mockResolvedValueOnce(originalRow())

    await GET(request())

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ continuationServedAt: null }),
    }))
  })

  it("still answers a retry inside the grace period", async () => {
    // A dropped response must not leave the agent restarting the conversation,
    // which is the exact failure this feature exists to prevent.
    mocks.findFirst
      .mockResolvedValueOnce(callbackRow({ continuationServedAt: new Date(Date.now() - 30_000) }))
      .mockResolvedValueOnce(originalRow())

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ continuation: TRANSCRIPT, conversation: null })
    // Already stamped, so the window is not pushed forward by the retry.
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("goes silent once the grace period has passed", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(callbackRow({ continuationServedAt: new Date(Date.now() - 10 * 60_000) }))
      .mockResolvedValueOnce(originalRow())

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ continuation: null, conversation: null })
  })

  it("returns nothing for an ordinary call", async () => {
    // The fence that makes a stolen token useless: an id that is not a callback
    // yields nothing regardless of who is asking.
    mocks.findFirst.mockResolvedValueOnce(callbackRow({ continuesCallId: null }))

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ continuation: null, conversation: null })
    expect(mocks.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns nothing when the original conversation is old", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(callbackRow())
      .mockResolvedValueOnce(originalRow({ endedAt: new Date(Date.now() - 60 * 60_000) }))

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ continuation: null, conversation: null })
  })

  it("rejects a malformed call id before touching the database", async () => {
    const response = await GET(request("not-a-uuid"))
    expect(response.status).toBe(400)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})

describe("lead correspondence", () => {
  function message(direction: string, body: string) {
    return { direction, body }
  }

  it("hands the agent what was written, newest last", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1",
    }))
    mocks.findMessages.mockResolvedValue([
      message("outbound", "Qiymət göndərdik."),
      message("inbound", "Salam, qiymət neçədir?"),
    ])

    const response = await GET(request())

    // Stored newest-first, delivered oldest-first: the agent has to read it as
    // a conversation, not as a stack.
    await expect(response.json()).resolves.toEqual({
      continuation: null,
      conversation: "Müştəri: Salam, qiymət neçədir?\nBiz: Qiymət göndərdik.",
    })
  })

  it("says nothing when the lead never wrote", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1",
    }))
    mocks.findMessages.mockResolvedValue([])

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({
      continuation: null, conversation: null,
    })
  })

  it("does not look up correspondence for a call with no lead", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: null,
    }))

    await GET(request())

    expect(mocks.findMessages).not.toHaveBeenCalled()
  })

  it("leaves human calls out of it", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1", callMode: "human",
    }))

    await GET(request())

    expect(mocks.findMessages).not.toHaveBeenCalled()
  })

  it("drops the oldest messages when the budget runs out", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1",
    }))
    // Newest-first, as the query returns them. Each message is capped at 300
    // chars, so it takes a full thread to exhaust the 1800-char budget.
    mocks.findMessages.mockResolvedValue([
      message("inbound", "son söz"),
      ...Array.from({ length: 8 }, () => message("outbound", "ə".repeat(400))),
      message("inbound", "ən köhnə"),
    ])

    const response = await GET(request())
    const body = await response.json()

    // What was said last survives; the oldest is what gets sacrificed.
    expect(body.conversation).toContain("son söz")
    expect(body.conversation).not.toContain("ən köhnə")
  })

  it("never returns a name, a phone or an id", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1",
    }))
    mocks.findMessages.mockResolvedValue([message("inbound", "Salam")])

    await GET(request())

    // Auto-created leads carry junk names, and an agent mispronouncing one
    // confidently is worse than an agent that never uses it.
    const selected = mocks.findMessages.mock.calls[0][0].select
    expect(Object.keys(selected).sort()).toEqual(["body", "direction"])
  })

  it("asks only for recent correspondence", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({
      continuesCallId: null, leadId: "lead-1",
    }))
    mocks.findMessages.mockResolvedValue([])

    await GET(request())

    const where = mocks.findMessages.mock.calls[0][0].where
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(mocks.findMessages.mock.calls[0][0].take).toBe(10)
  })
})

describe("an inbound call the AI answered", () => {
  function inboundRow(overrides: Record<string, unknown> = {}) {
    return callbackRow({ continuesCallId: null, direction: "inbound", ...overrides })
  }

  it("gives the agent the organisation's inbound greeting and says the customer called", async () => {
    mocks.findFirst.mockResolvedValueOnce(inboundRow())
    mocks.findConfigs.mockResolvedValue([{
      settings: {
        provider: "asterisk",
        voiceAgentEnabled: true,
        voiceAgentInboundGreeting: "  Salam, Gobustone! Sizi dinləyirəm.  ",
      },
    }])

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({
      continuation: null,
      conversation: null,
      opening: "Salam, Gobustone! Sizi dinləyirəm.",
      context: INBOUND_CALL_CONTEXT,
    })
  })

  it("falls back to the neutral inbound greeting when the organisation wrote none", async () => {
    mocks.findFirst.mockResolvedValueOnce(inboundRow())
    mocks.findConfigs.mockResolvedValue([{ settings: { provider: "asterisk", voiceAgentEnabled: true } }])

    const body = await (await GET(request())).json()

    expect(body.opening).toBe(DEFAULT_INBOUND_GREETING)
    expect(body.opening).not.toMatch(/zəng etmişəm/u)
  })

  it.each(["ai", "human_then_ai"])("passes separate rules when AI answers in %s mode", async (mode) => {
    mocks.findFirst.mockResolvedValueOnce(inboundRow())
    mocks.findConfigs.mockResolvedValue([{
      settings: {
        provider: "asterisk", voiceAgentEnabled: true, inboundAnswerMode: mode,
        voiceAgentInboundGreeting: "Salam! Mən virtual köməkçiyəm.",
        voiceAgentInboundRules: "  Məsləhət təklif et və bir sual ver.  ",
        voiceAgentPrompt: "Unrelated outbound script",
      },
    }])
    const body = await (await GET(request())).json()
    expect(body.opening).toBe("Salam! Mən virtual köməkçiyəm.")
    expect(body.context).toContain(INBOUND_CALL_CONTEXT)
    expect(body.context).toContain("Məsləhət təklif et və bir sual ver.")
    expect(body.context).not.toContain("Unrelated outbound script")
    expect(mocks.findConfigs.mock.calls[0][0].where.organizationId).toBe("org-test")
  })

  it("keeps an inbound-origin callback on its continuation without new greeting/rules", async () => {
    mocks.findFirst.mockResolvedValueOnce(callbackRow({ direction: "inbound" })).mockResolvedValueOnce(originalRow())
    const body = await (await GET(request())).json()
    expect(body).toEqual({ continuation: TRANSCRIPT, conversation: null })
    expect(mocks.findConfigs).not.toHaveBeenCalled()
  })

  it("fits multibyte JSON by removing oldest correspondence, preserving exact greeting and rules", async () => {
    mocks.findFirst.mockResolvedValueOnce(inboundRow({ leadId: "lead-1" }))
    const opening = "漢".repeat(500)
    const rules = "語".repeat(1_000)
    mocks.findConfigs.mockResolvedValue([{
      settings: { provider: "asterisk", voiceAgentEnabled: true, voiceAgentInboundGreeting: opening, voiceAgentInboundRules: rules },
    }])
    mocks.findMessages.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
      direction: "inbound", body: `${index}${"字".repeat(298)}`,
    })))
    const text = await (await GET(request())).text()
    const body = JSON.parse(text)
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(8_000)
    expect(body.opening).toBe(opening)
    expect(body.context).toContain(rules)
    expect(body.conversation).toContain(`0${"字".repeat(298)}`)
    expect(body.conversation).not.toContain(`4${"字".repeat(298)}`)
  })

  it("adds nothing to an outbound AI call or to a human inbound call", async () => {
    for (const row of [
      callbackRow({ continuesCallId: null, direction: "outbound" }),
      inboundRow({ callMode: "human" }),
    ]) {
      mocks.findFirst.mockResolvedValueOnce(row)
      const body = await (await GET(request())).json()
      expect(body).toEqual({ continuation: null, conversation: null })
    }
    expect(mocks.findConfigs).not.toHaveBeenCalled()
  })
})

/**
 * A call the demo placed (2026-10-18). The station speaks `opening` word for
 * word and appends `context` to that one call; without them the prospect was
 * greeted with the line's own greeting — another business's — and asked about
 * building materials and square metres.
 */
describe("a call the demo placed", () => {
  const demoRow = (overrides: Record<string, unknown> = {}) => callbackRow({
    continuesCallId: null,
    direction: "outbound",
    leadId: "lead-demo",
    consentAudit: { via: "demo_center" },
    ...overrides,
  })

  beforeEach(() => {
    mocks.findLead.mockReset()
    mocks.findLead.mockResolvedValue({ contactName: "Nigar Əliyeva" })
    mocks.createEvents.mockReset()
    mocks.createEvents.mockResolvedValue({ count: 1 })
  })

  it("opens as LeadDrive with the approved first sentence, frames the call, caps it at two minutes and names it a demo", async () => {
    const { buildDemoCallContext, buildDemoCallPrompt, demoCallOpening, DEMO_CALL_CLOSING_KEY, DEMO_CALL_CLOSING_KEYS, DEMO_CALL_MAX_SECONDS } = await import("@/lib/demo-center/call-prompt")
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    const body = await (await GET(request())).json()
    expect(body).toEqual({
      continuation: null,
      conversation: null,
      opening: demoCallOpening("Nigar"),
      context: buildDemoCallContext(),
      maxSeconds: DEMO_CALL_MAX_SECONDS,
      // The station's core drops the line's own sales rules only on this flag,
      // and speaks the demo's script instead of the line's prompt.
      variant: "demo",
      prompt: buildDemoCallPrompt({ firstName: "Nigar" }),
      closingKey: DEMO_CALL_CLOSING_KEY,
      closingKeys: [...DEMO_CALL_CLOSING_KEYS],
    })
    expect(body.prompt).not.toMatch(/Gobustone/i)
    expect(body.opening).toMatch(/^Salam, Nigar! Mən LeadDrive-ın AI köməkçisiyəm/)
    expect(body.opening).not.toMatch(/Gobustone/i)
    expect(DEMO_CALL_MAX_SECONDS).toBe(120)
  })

  it("fits what the station reads: 500 characters of opening, 2,000 of context, 4,000 of script, 8,192 bytes in all", async () => {
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    const response = await GET(request())
    const text = await response.text()
    const body = JSON.parse(text)
    expect(body.opening.length).toBeLessThanOrEqual(500)
    expect(body.context.length).toBeLessThanOrEqual(2_000)
    expect(body.prompt.length).toBeLessThanOrEqual(4_000)
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(8_192)
    // It tells the agent the line's own rules are not for this call.
    expect(body.context).toContain("kvadratmetr")
    expect(body.context).toContain("aid deyil")
  })

  it("greets without a name it cannot read, and never hands over the prospect's phone, email or correspondence", async () => {
    mocks.findLead.mockResolvedValueOnce({ contactName: "123 <x>" })
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    const body = await (await GET(request())).json()
    expect(body.opening).toMatch(/^Salam! Mən LeadDrive-ın/)
    expect(body.conversation).toBeNull()
    expect(mocks.findMessages).not.toHaveBeenCalled()
  })

  it("writes only the connecting signal, whichever core asks", async () => {
    const { DEMO_CALL_CONNECTING_EVENT } = await import("@/lib/demo-center/call-prompt-match")
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    await GET(request(callId, "runtime-token", "&caps=demo-v1"))
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    await GET(request())
    const written = mocks.createEvents.mock.calls.map((call) => call[0].data[0].eventType)
    expect(written).toEqual([DEMO_CALL_CONNECTING_EVENT, DEMO_CALL_CONNECTING_EVENT])
  })

  it("names the closing the station listens for to end the call, in every language the script allows", async () => {
    const { DEMO_CALL_CLOSING, DEMO_CALL_CLOSING_EN, DEMO_CALL_CLOSING_KEY, DEMO_CALL_CLOSING_KEYS, DEMO_CALL_CLOSING_RU } = await import("@/lib/demo-center/call-prompt")
    mocks.findFirst.mockResolvedValueOnce(demoRow())
    const body = await (await GET(request())).json()
    expect(body.closingKey).toBe(DEMO_CALL_CLOSING_KEY)
    expect(body.closingKeys).toEqual([...DEMO_CALL_CLOSING_KEYS])
    // The script the agent speaks carries each closing word for word, so the station can hear it.
    for (const [closing, key] of [[DEMO_CALL_CLOSING, DEMO_CALL_CLOSING_KEYS[0]], [DEMO_CALL_CLOSING_RU, DEMO_CALL_CLOSING_KEYS[1]], [DEMO_CALL_CLOSING_EN, DEMO_CALL_CLOSING_KEYS[2]]]) {
      expect(closing.toLowerCase()).toContain(key)
      expect(body.prompt).toContain(closing)
    }
  })

  it("ends every way the script ends a call with words the station listens for", async () => {
    // The model cannot hang up: the station ends the call once it has heard a
    // closing key. An ending without one — a refusal, «do not call me again»,
    // the time running out — left the line silent until the cap.
    const { buildDemoCallContext, buildDemoCallPrompt, DEMO_CALL_CLOSING_KEYS } = await import("@/lib/demo-center/call-prompt")
    const sentences = [buildDemoCallPrompt({ firstName: "Nigar" }), buildDemoCallContext()]
      .flatMap((text) => text.split("\n"))
      .filter((line) => /zəngi bitir|sağollaş|bitir\b/i.test(line))
    expect(sentences.length).toBeGreaterThanOrEqual(4)
    for (const line of sentences) {
      expect(line, line).not.toMatch(/sağollaş/i)
      const quoted = [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1].toLowerCase())
      expect(quoted.some((text) => DEMO_CALL_CLOSING_KEYS.some((key) => text.includes(key))), line).toBe(true)
    }
  })

  it("leaves every other call exactly as it was", async () => {
    mocks.findFirst.mockResolvedValueOnce(demoRow({ consentAudit: { via: "manual" } }))
    expect(await (await GET(request())).json()).toEqual({ continuation: null, conversation: null })
    mocks.findFirst.mockResolvedValueOnce(demoRow({ callMode: "human" }))
    expect(await (await GET(request())).json()).toEqual({ continuation: null, conversation: null })
  })
})

describe("trimTranscriptTail", () => {
  it("keeps only the last few turns", () => {
    const long = Array.from({ length: 20 }, (_, i) => `AI operator: sətir ${i}`).join("\n")
    const tail = trimTranscriptTail(long)
    expect(tail.split("\n")).toHaveLength(6)
    expect(tail).toContain("sətir 19")
    expect(tail).not.toContain("sətir 13")
  })

  it("keeps the end rather than the start when capping length", () => {
    // The thread is picked up from the last thing said.
    const huge = `Müştəri: ${"ə".repeat(4_000)}\nAI operator: son söz`
    expect(trimTranscriptTail(huge)).toContain("son söz")
  })

  it("drops blank lines instead of spending the budget on them", () => {
    expect(trimTranscriptTail("\n\nAI operator: salam\n\n")).toBe("AI operator: salam")
  })
})
