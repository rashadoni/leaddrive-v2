import { describe, expect, it } from "vitest"

import { selectVoipPopupCall } from "@/lib/voip/active-call-selection"

const NOW = Date.parse("2026-08-26T16:00:00.000Z")

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    direction: "inbound",
    status: "ringing",
    provider: "asterisk",
    claimedByUserId: null,
    browserAnswerClaimExpiresAt: null,
    ...overrides,
  }
}

describe("active call popup selection", () => {
  it("skips a fresh Asterisk claim owned by another seller", () => {
    const selected = selectVoipPopupCall([
      call({
        id: "theirs",
        claimedByUserId: "sales-1",
        browserAnswerClaimExpiresAt: "2026-08-26T16:00:20.000Z",
      }),
      call({ id: "free" }),
    ], new Set(), "sales-2", NOW)

    expect(selected?.id).toBe("free")
  })

  it("returns an expired ringing claim to the shared queue", () => {
    const selected = selectVoipPopupCall([
      call({
        id: "expired",
        claimedByUserId: "sales-1",
        browserAnswerClaimExpiresAt: "2026-08-26T15:59:59.000Z",
      }),
    ], new Set(), "sales-2", NOW)

    expect(selected?.id).toBe("expired")
  })

  it("keeps answering and live calls visible only to their owner", () => {
    expect(selectVoipPopupCall([
      call({ id: "mine", status: "answering", claimedByUserId: "sales-2" }),
    ], new Set(), "sales-2", NOW)?.id).toBe("mine")

    expect(selectVoipPopupCall([
      call({ id: "theirs", status: "in-progress", claimedByUserId: "sales-1" }),
    ], new Set(), "sales-2", NOW)).toBeUndefined()
  })

  it("preserves the existing WhatsApp owner and dismissal rules", () => {
    const outbound = call({
      id: "wa",
      direction: "outbound",
      provider: "whatsapp",
      status: "initiated",
      claimedByUserId: "sales-2",
    })

    expect(selectVoipPopupCall([outbound], new Set(), "sales-2", NOW)?.id).toBe("wa")
    expect(selectVoipPopupCall([outbound], new Set(["wa"]), "sales-2", NOW)).toBeUndefined()
  })
})
