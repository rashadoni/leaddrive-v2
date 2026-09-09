import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8")
}

describe("incoming call popup identifies leads as well as contacts", () => {
  it("carries lead identity through the polling provider", () => {
    const provider = source("src/components/voip-call-provider.tsx")

    expect(provider).toContain("leadId: string | null")
    expect(provider).toContain("lead: { contactName: string; companyName: string | null } | null")
  })

  it("threads browser-call capability and safe claim expiry through popup selection", () => {
    const provider = source("src/components/voip-call-provider.tsx")

    expect(provider).toContain("browserAnswerClaimExpiresAt?: string | null")
    expect(provider).toContain("selectVoipPopupCall(")
    expect(provider).toContain('fetch("/api/v1/voip/capabilities"')
    expect(provider).toContain("browserCallsEnabled={browserCallsEnabled}")
  })

  it("shows the lead name and opens the lead card when no contact matched", () => {
    const popup = source("src/components/incoming-call-popup.tsx")

    expect(popup).toContain("call.contact?.fullName || call.lead?.contactName")
    expect(popup).toContain("call.leadId && call.lead ? (")
    expect(popup).toContain("href={`/leads/${call.leadId}`}")
    expect(popup).toContain('t("viewLead")')
  })

  it.each(["en", "ru", "az"])("has localized lead actions in %s", (locale) => {
    const messages = JSON.parse(source(`messages/${locale}.json`))
    expect(messages.voip.viewLead).toEqual(expect.any(String))
    expect(messages.voip.viewLead.trim()).not.toBe("")
  })

  it.each(["en", "ru", "az"])("has localized browser-answer states in %s", (locale) => {
    const messages = JSON.parse(source(`messages/${locale}.json`))
    for (const key of [
      "inboundCallAnswer",
      "inboundCallPreparing",
      "inboundCallConnecting",
      "inboundCallLive",
      "inboundCallHangUp",
      "inboundCallMicrophoneDenied",
      "inboundCallAudioUnsupported",
      "inboundCallClaimed",
      "inboundCallClaimLost",
      "inboundCallFailed",
    ]) {
      expect(messages.voip[key], `${locale}.${key}`).toEqual(expect.any(String))
      expect(messages.voip[key].trim(), `${locale}.${key}`).not.toBe("")
    }
  })
})
