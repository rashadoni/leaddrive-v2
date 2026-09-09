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
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    channelMessage: { findMany: mocks.findMessages },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))

import { GET, trimTranscriptTail } from "@/app/api/internal/voice-agent/call-continuation/route"

const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrg = process.env.VOICE_AGENT_ORGANIZATION_ID
const callId = "5f1a3b0c-2d4e-4a6b-8c9d-0e1f2a3b4c5d"

const TRANSCRIPT = [
  "AI operator: Salam, necəsiniz?",
  "Müştəri: Yaxşı, qiymət neçədir?",
  "AI operator: Üç yüz manatdır.",
].join("\n")

function request(id: string = callId, token = "runtime-token") {
  return new NextRequest(
    `http://localhost/api/internal/voice-agent/call-continuation?callId=${id}`,
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
