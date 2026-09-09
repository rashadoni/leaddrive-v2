import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { aiCallBlockerTranslationKey } from "@/components/leads/lead-ai-call-action"

const component = readFileSync("src/components/leads/lead-ai-call-action.tsx", "utf8")
const leadPage = readFileSync("src/app/(dashboard)/leads/[id]/page.tsx", "utf8")
const businessHoursPage = readFileSync("src/app/(dashboard)/inbox/business-hours/page.tsx", "utf8")
const businessHoursLib = readFileSync("src/lib/inbox/business-hours.ts", "utf8")
const voipSettingsPage = readFileSync("src/app/(dashboard)/settings/voip/page.tsx", "utf8")

describe("manual lead AI call UI contract", () => {
  it("places a separate primary AI call action first in the responsive lead header", () => {
    expect(leadPage).toContain('import { LeadAiCallAction }')
    expect(leadPage).toContain("flex flex-col gap-4 lg:flex-row lg:items-start")
    expect(leadPage).toContain("flex w-full flex-wrap items-center gap-2")
    expect(leadPage.indexOf("<LeadAiCallAction")).toBeLessThan(leadPage.indexOf('lead.status !== "converted"'))
    expect(component).not.toContain("ClickToCallButton")
  })

  it("runs GET preflight only from the dialog action and confirms before POST", () => {
    expect(component).toContain('method: "GET"')
    expect(component).toContain('method: "POST"')
    expect(component).toContain("void checkEligibility()")
    expect(component).toContain("consentConfirmed: true")
    expect(component).toContain('type="checkbox"')
    expect(component).toContain("disabled={!consentConfirmed}")
    expect(component).toContain("crypto.randomUUID()")
  })

  it("reuses one request key and ignores stale GET and POST responses", () => {
    expect(component).toContain("idempotencyKeyRef")
    expect(component).toContain("AbortController")
    expect(component).toContain("requestVersionRef")
    expect(component).toContain("controller.signal.aborted")
    expect(component).toContain("requestVersion !== requestVersionRef.current")
    expect(component.match(/signal: controller\.signal/g)).toHaveLength(3)
  })

  it("offers a manager-only no-redial acknowledgement for provider-unknown manual calls", () => {
    expect(component).toContain("canResolveUnknownCall")
    expect(component).toContain("unknownResolutionConfirmed")
    expect(component).toContain("/resolve-unknown")
    expect(component).toContain('resolution: "unknown_no_redial"')
    expect(component).toContain("acknowledgeNoRedial: true")
  })

  it("covers accessible checking, blocked, accepted, and error states", () => {
    expect(component).toContain('aria-haspopup="dialog"')
    expect(component).toContain('aria-busy="true"')
    expect(component).toContain('role="alert"')
    expect(component).toContain('role="status"')
    expect(component).toContain('aria-live="polite"')
    expect(component).toContain("min-h-11")
    expect(component).toContain("motion-reduce:animate-none")
  })

  it("does not send or render a raw destination, provider detail, or call identifiers", () => {
    expect(component).not.toContain("toNumber")
    expect(component).not.toContain("phoneNumber")
    expect(component).not.toContain("providerConfigId")
    expect(component).not.toContain("sessionId")
    expect(component).not.toContain("callLogId")
  })

  it("maps calling-hours and consent blockers to distinct local copy", () => {
    expect(aiCallBlockerTranslationKey("voice_calling_hours_unconfigured")).toBe("blockerHoursUnconfigured")
    expect(aiCallBlockerTranslationKey("OUTSIDE_CALLING_HOURS")).toBe("blockerOutsideHours")
    expect(aiCallBlockerTranslationKey("consent-required")).toBe("blockerConsentRequired")
    expect(aiCallBlockerTranslationKey("provider internal detail")).toBe("blockerGeneric")
  })
})

describe("manual AI call settings contract", () => {
  it("offers a dedicated voice business-hours schedule without message-only controls", () => {
    expect(businessHoursLib).toContain('"voice"')
    expect(businessHoursPage).toContain('| "voice"')
    expect(businessHoursPage).toContain('selectedChannel === "voice"')
    expect(businessHoursPage).toContain('t("businessHoursVoiceTitle")')
  })

  it("keeps the manual lead AI call kill switch independent and off by default", () => {
    expect(voipSettingsPage).toContain("manualLeadAiCallsEnabled?: boolean")
    expect(voipSettingsPage).toContain(
      "const [manualLeadAiCallsEnabled, setManualLeadAiCallsEnabled] = useState(false)",
    )
    expect(voipSettingsPage).toContain("s.manualLeadAiCallsEnabled === true")
    expect(voipSettingsPage).toContain("manualLeadAiCallsEnabled,")
    expect(voipSettingsPage).toContain('id="manual-lead-ai-calls"')
    expect(voipSettingsPage).toContain(
      'disabled={!voiceAgentEnabled || provider !== "asterisk" || voiceAgentMode === "inbound"}',
    )
  })

  it("keeps the technical policy active without exposing its internal version label", () => {
    expect(voipSettingsPage).toContain('t("voiceAgentSystemPolicyTitle")')
    expect(voipSettingsPage).not.toContain("TECHNICAL_VOICE_POLICY_VERSION")
    expect(voipSettingsPage).not.toContain("fanum-voice-policy-v1")
  })
})
