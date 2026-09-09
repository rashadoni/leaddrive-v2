import { describe, expect, it } from "vitest"

import { accessibleCallWhere, aiCallOwnershipWhere, callAccessScope, canReadCall, exposeCallForClient } from "@/lib/calls/access"

describe("call access helpers", () => {
  it("classifies calls by the most specific customer module scope", () => {
    expect(callAccessScope({ ticketId: "ticket-1", conversationId: "conversation-1" })).toBe("tickets")
    expect(callAccessScope({ conversationId: "conversation-1" })).toBe("inbox")
    expect(callAccessScope({ dealId: "deal-1", contactId: "contact-1" })).toBe("deals")
    expect(callAccessScope({ contactId: "contact-1" })).toBe("contacts")
    expect(callAccessScope({})).toBe("voip")
  })

  it("does not expose provider recording URLs to the client", () => {
    const exposed = exposeCallForClient({
      id: "call-1",
      status: "completed",
      recordingUrl: "https://provider.example/recording.mp3",
      leadCallClaimToken: "lead-claim-secret",
      browserAnswerClaimToken: "browser-answer-secret",
    })

    expect("recordingUrl" in exposed).toBe(false)
    expect("leadCallClaimToken" in exposed).toBe(false)
    expect("browserAnswerClaimToken" in exposed).toBe(false)
    expect(exposed.hasRecording).toBe(true)
    expect(exposed.recordingPlaybackUrl).toBe("/api/v1/calls/call-1/recording")
  })

  it("keeps the protected playback path stable for ids that need encoding", () => {
    const exposed = exposeCallForClient({
      id: "call/with space",
      recordingUrl: "https://provider.example/recording.mp3",
    })

    expect(exposed.recordingPlaybackUrl).toBe("/api/v1/calls/call%2Fwith%20space/recording")
  })

  it("lets ticketing-only users play ticket calls without opening inbox or global VoIP recordings", () => {
    expect(canReadCall("ticketing", { ticketId: "ticket-1" })).toBe(true)
    expect(canReadCall("ticketing", { conversationId: "conversation-1" })).toBe(false)
    expect(canReadCall("ticketing", {})).toBe(false)
  })

  it("keeps AI calls private to the initiating salesperson", () => {
    const ownAiCall = { leadId: "lead-1", callMode: "ai", userId: "sales-1" }
    expect(canReadCall("sales", ownAiCall, "sales-1")).toBe(true)
    expect(canReadCall("sales", ownAiCall, "sales-2")).toBe(false)
    expect(canReadCall("manager", ownAiCall, "manager-1")).toBe(true)

    expect(accessibleCallWhere("sales", "sales-1")).toEqual(expect.objectContaining({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([{ callMode: "ai", userId: "sales-1" }]),
        }),
      ]),
    }))
    expect(aiCallOwnershipWhere("manager", "manager-1")).toEqual({})
  })
})
