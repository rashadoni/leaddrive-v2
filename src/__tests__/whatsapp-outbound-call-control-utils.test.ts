import { describe, expect, it } from "vitest"
import {
  canRequestWhatsAppCallPermission,
  canStartWhatsAppCall,
  normalizeWhatsAppPermissionPayload,
  whatsAppCallBlockedReason,
} from "@/components/inbox/whatsapp-outbound-call-control-utils"

describe("WhatsApp outbound call control state", () => {
  it("does not allow a permission request until Meta explicitly allows it", () => {
    expect(canRequestWhatsAppCallPermission(null)).toBe(false)
    expect(canRequestWhatsAppCallPermission({ status: "unknown", canRequest: false, canStartCall: false })).toBe(false)
    expect(canRequestWhatsAppCallPermission({ status: "no_permission", canRequest: true, canStartCall: false })).toBe(true)
  })

  it("does not allow a call until Meta explicitly allows start_call", () => {
    expect(canStartWhatsAppCall(null)).toBe(false)
    expect(canStartWhatsAppCall({ status: "temporary", canRequest: false, canStartCall: false })).toBe(false)
    expect(canStartWhatsAppCall({ status: "temporary", canRequest: false, canStartCall: true })).toBe(true)
  })

  it("keeps provider errors from failed permission checks so the UI stays blocked", () => {
    const normalized = normalizeWhatsAppPermissionPayload({
      permission: {
        status: "unknown",
        canRequest: false,
        canStartCall: false,
        lastError: "Calling API not enabled",
      },
      provider: {
        success: false,
        canRequest: false,
        canStartCall: false,
        error: "WhatsApp Cloud API Calling not enabled for this phone number.",
      },
    })

    expect(normalized.permission?.canRequest).toBe(false)
    expect(normalized.providerError).toBe("WhatsApp Cloud API Calling not enabled for this phone number.")
    expect(whatsAppCallBlockedReason(normalized.permission, normalized.providerError, "Unavailable")).toBe(
      "WhatsApp Cloud API Calling not enabled for this phone number.",
    )
  })
})
