import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { normalizeQueueListPayload } from "@/components/voice-call-queues/voice-call-queue-list"
import {
  getCurrentQueueItem,
  getNextQueueItem,
  normalizeQueueDetailPayload,
  queueItemStatusTranslationKey,
  queueStatusTranslationKey,
} from "@/components/voice-call-queues/voice-call-queue-workspace"
import {
  isVoiceQueueDisabledCode,
  queueExclusionTranslationKey,
} from "@/components/voice-call-queues/voice-call-queue-preview"

const leadsPage = readFileSync("src/app/(dashboard)/leads/page.tsx", "utf8")
const preview = readFileSync("src/components/voice-call-queues/voice-call-queue-preview.tsx", "utf8")
const workspace = readFileSync("src/components/voice-call-queues/voice-call-queue-workspace.tsx", "utf8")
const workspacePage = readFileSync("src/app/(dashboard)/voip/call-queues/[id]/page.tsx", "utf8")
const list = readFileSync("src/components/voice-call-queues/voice-call-queue-list.tsx", "utf8")
const messages = Object.fromEntries(
  ["en", "ru", "az"].map((locale) => [
    locale,
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string, unknown>,
  ]),
)

describe("sequential AI call queue UI", () => {
  it("uses the existing lead selection and opens an inline preview before creation", () => {
    expect(leadsPage).toContain("selectedLeadIds")
    expect(leadsPage).toContain("aiCallSelected")
    expect(leadsPage).toContain("<VoiceCallQueuePreview")
    expect(leadsPage).toContain("showAiQueuePreview && selectedQueueLeads.length > 0")
    expect(preview).toContain('aria-labelledby="voice-call-queue-preview-title"')
    expect(preview).not.toContain("<Dialog")
  })

  it("requires an explicit human consent attestation and never creates when disabled", () => {
    expect(preview).toContain('type="checkbox"')
    expect(preview).toContain("consentConfirmed: true")
    expect(preview).toContain("!consentConfirmed")
    expect(preview).toContain("queueDisabled")
    expect(preview).toContain('disabled={phase === "creating" || preview.eligible.length === 0 || queueDisabled || !consentConfirmed}')
    expect(isVoiceQueueDisabledCode("voice_queue_disabled")).toBe(true)
    expect(isVoiceQueueDisabledCode("FEATURE-DISABLED")).toBe(true)
  })

  it("states the one-at-a-time rule in every locale", () => {
    const en = messages.en.voiceCallQueue as Record<string, string>
    const ru = messages.ru.voiceCallQueue as Record<string, string>
    const az = messages.az.voiceCallQueue as Record<string, string>
    expect(en.sequencePromise).toContain("one at a time")
    expect(ru.sequencePromise).toContain("по одному")
    expect(az.sequencePromise).toContain("bir-bir")
  })

  it("explains how to add leads and does not present automatic enrollment as available", () => {
    expect(list).toContain('t("semiAutomaticStep1")')
    expect(list).toContain('t("semiAutomaticStep2")')
    expect(list).toContain('t("semiAutomaticStep3")')
    expect(list).toContain('t("modeUnavailable")')

    for (const locale of ["en", "ru", "az"] as const) {
      const copy = messages[locale].voiceCallQueue as Record<string, string>
      expect(copy.semiAutomaticDescription).toBeTruthy()
      expect(copy.automaticDescription).toBeTruthy()
      expect(copy.modeUnavailable).toBeTruthy()
    }
    expect((messages.ru.voiceCallQueue as Record<string, string>).automaticDescription).toContain("ничего не создаёт")
  })

  it("maps only one active item as current and the first pending item as next", () => {
    const detail = normalizeQueueDetailPayload({
      success: true,
      data: {
        queue: { id: "queue-1", status: "running", totalItems: 4 },
        items: [
          { id: "item-1", leadId: "lead-1", position: 1, status: "completed" },
          { id: "item-2", leadId: "lead-2", position: 2, status: "waiting_terminal" },
          { id: "item-3", leadId: "lead-3", position: 3, status: "pending" },
          { id: "item-4", leadId: "lead-4", position: 4, status: "pending" },
        ],
      },
    })
    expect(detail).not.toBeNull()
    expect(getCurrentQueueItem(detail!.items)?.id).toBe("item-2")
    expect(getNextQueueItem(detail!.items)?.id).toBe("item-3")
  })

  it("reads nested API counts instead of treating pending calls as finished", () => {
    const queues = normalizeQueueListPayload({
      success: true,
      data: {
        queues: [{
          id: "queue-1",
          status: "prepared",
          totalItems: 5,
          counts: {
            pending: 3,
            claimed: 1,
            dispatching: 0,
            waiting_terminal: 0,
            dispatch_uncertain: 0,
            completed: 1,
            no_answer: 0,
            busy: 0,
            failed: 0,
            cancelled: 0,
            blocked: 0,
            skipped: 0,
          },
        }],
      },
    })
    expect(queues?.[0]).toMatchObject({
      pendingCount: 3,
      activeCount: 1,
      finishedCount: 1,
    })
  })

  it("uses the final prepared and skip contracts", () => {
    expect(queueStatusTranslationKey("prepared")).toBe("statusPrepared")
    expect(queueStatusTranslationKey("draft")).toBe("statusUnknown")
    expect(queueItemStatusTranslationKey("dispatch_uncertain")).toBe("itemCheckingOutcome")
    expect(workspace).toContain('queueStatus === "prepared"')
    expect(workspace).toContain('value="seller_skipped"')
    expect(workspace).toContain('value="duplicate_lead"')
    expect(workspace).not.toContain('value="manual_skip"')
  })

  it("offers pause, resume, cancel, skip and lead navigation without provider details", () => {
    expect(workspace).toContain('runQueueAction("pause")')
    expect(workspace).toContain('runQueueAction("resume")')
    expect(workspace).toContain('runQueueAction("cancel")')
    expect(workspace).toContain("/skip")
    expect(workspace).toContain("/leads/")
    for (const source of [preview, workspace, list]) {
      expect(source).not.toContain("phoneNumber")
      expect(source).not.toContain("toNumber")
      expect(source).not.toContain("providerConfigId")
      expect(source).not.toContain("transcript")
      expect(source).not.toContain("voiceCallSessionId")
    }
  })

  it("keeps uncertain release hidden until provider finality is proven", () => {
    expect(workspacePage).toContain("const canResolveUncertain = false")
    expect(workspace).toContain("canResolveUncertain")
    expect(workspace).toContain("/resolve-uncertain")
    expect(workspace).toContain('resolution: "unknown_no_redial"')
    expect(workspace).toContain("acknowledgeNoRedial: true")
    expect(workspace).not.toContain("retryUncertain")
  })

  it("translates stable exclusions without rendering backend jargon", () => {
    expect(queueExclusionTranslationKey("phone_conversation_exists")).toBe("exclusionConnectedBefore")
    expect(queueExclusionTranslationKey("duplicate_phone")).toBe("exclusionAlreadyQueued")
    expect(queueExclusionTranslationKey("VOICE-OPT-OUT")).toBe("exclusionOptOut")
    expect(queueExclusionTranslationKey("internal_provider_detail")).toBe("exclusionGeneric")
  })
})
