import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}))

import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendGuardedWhatsAppReopenNotification } from "@/lib/inbox/whatsapp-reopen-notification"

describe("WhatsApp reopen notification commitment boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("never sends the legacy callback promise, and keeps the part it can honour", async () => {
    const unsafeOriginal =
      "Sorğunuz (WA-1042) yenidən açıldı. Menecer tezliklə sizinlə əlaqə saxlayacaq."

    const result = await sendGuardedWhatsAppReopenNotification({
      organizationId: "org-1",
      to: "994501234567",
      ticketNumber: "WA-1042",
      customerText: "Salam, problemim hələ həll olunmayıb",
      contactId: "contact-1",
    })

    // The guarantee is about the PROMISE, not about one exact string. The guard
    // used to replace the whole message with a generic fallback; it now strips
    // the offending sentence and keeps the rest, so the customer still learns
    // their ticket was reopened instead of receiving only "a manager must
    // reply". Asserting the old literal made a better outcome look like a
    // regression.
    expect(result.text).not.toContain("Menecer tezliklə")   // the unconfirmable callback
    expect(result.text).not.toContain("əlaqə saxlayacaq")
    expect(result.text).toContain("WA-1042")                // the part that is true
    expect(result.violations).toEqual(["unconfirmed_time"])
    expect(result.forceHandoff).toBe(true)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith({
      to: "994501234567",
      message: result.text,
      organizationId: "org-1",
      contactId: "contact-1",
    })

    const outbound = vi.mocked(sendWhatsAppMessage).mock.calls[0]?.[0]?.message
    expect(outbound).not.toBe(unsafeOriginal)
    expect(outbound).not.toContain("tezliklə")
    expect(outbound).not.toContain("əlaqə saxlayacaq")
  })
})
