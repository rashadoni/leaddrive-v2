import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/queue/connection", () => ({
  getRedisConnection: vi.fn(() => null),
}))

import {
  _clearWhatsAppCallSessionsForTests,
  deleteWhatsAppCallSession,
  getWhatsAppCallSession,
  storeWhatsAppCallSession,
} from "@/lib/whatsapp-call-sessions"

beforeEach(() => {
  _clearWhatsAppCallSessionsForTests()
  vi.clearAllMocks()
})

describe("WhatsApp call sessions", () => {
  it("stores and reads a short-lived call SDP session without Redis", async () => {
    await storeWhatsAppCallSession({
      organizationId: "org_1",
      callId: "wacid.123",
      sdp: "v=0\r\n...",
      sdpType: "offer",
      direction: "inbound",
      fromNumber: "994501234567",
      toNumber: "13175551399",
      conversationId: "sc_1",
    }, { ttlSeconds: 60 })

    const session = await getWhatsAppCallSession("org_1", "wacid.123")

    expect(session).toMatchObject({
      organizationId: "org_1",
      callId: "wacid.123",
      sdp: "v=0\r\n...",
      sdpType: "offer",
      direction: "inbound",
      conversationId: "sc_1",
    })
    expect(typeof session?.expiresAt).toBe("string")
  })

  it("scopes sessions by organization", async () => {
    await storeWhatsAppCallSession({
      organizationId: "org_1",
      callId: "wacid.123",
      sdp: "v=0\r\n...",
      sdpType: "offer",
      direction: "inbound",
      fromNumber: "a",
      toNumber: "b",
      conversationId: null,
    })

    await expect(getWhatsAppCallSession("other_org", "wacid.123")).resolves.toBeNull()
  })

  it("deletes a stored session", async () => {
    await storeWhatsAppCallSession({
      organizationId: "org_1",
      callId: "wacid.123",
      sdp: "v=0\r\n...",
      sdpType: "offer",
      direction: "inbound",
      fromNumber: "a",
      toNumber: "b",
      conversationId: null,
    })

    await deleteWhatsAppCallSession("org_1", "wacid.123")

    await expect(getWhatsAppCallSession("org_1", "wacid.123")).resolves.toBeNull()
  })
})
