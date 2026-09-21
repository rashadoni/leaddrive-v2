import type { DemoJourneyManifest, DemoJourneySection, DemoJourneyState } from "./types"

/**
 * The call section, for a grant whose admin allowed a real AI call.
 *
 * The owner decided on 2026-09-21 that the demo's call is real. The ordinary
 * section says, honestly, that the call is off in this session and moves on
 * as "skipped". This variant replaces only that section: the prospect proves
 * a phone, agrees, asks for the call, and the story records what actually
 * happened on the line — including that nobody answered, or that it could
 * not be placed at all. Every other section stays the scenario's own.
 *
 * It is derived, not copied, so the two can never drift apart: a change to
 * the scenario reaches both variants, and the manifest tests validate both.
 */

/** Every way a real call can end, the story's own ending first. */
export const DEMO_LIVE_CALL_OUTCOMES = [
  "CALL_RESULT_RECORDED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "CALL_BLOCKED",
  "CALL_ATTENTION_REQUIRED",
  "CALL_DECLINED",
] as const satisfies readonly DemoJourneyState[]

export const DEMO_CALL_SECTION_ID = "ai-call"
export const DEMO_LIVE_CALL_STEP_ID = "ai-call-live"

function liveCallSection(section: DemoJourneySection): DemoJourneySection {
  const [consent] = section.steps
  return {
    ...section,
    summary: "LeadDrive təsdiqlənmiş nömrənizə AI köməkçisi ilə zəng edir — bu demoda, həqiqətən.",
    exitStates: [...DEMO_LIVE_CALL_OUTCOMES],
    skippedNotice: undefined,
    steps: [
      {
        ...consent,
        instruction:
          "Zəng yalnız sizin razılığınızla olur: nömrəni SMS kodu ilə təsdiqləyirsiniz və ayrıca razılıq verirsiniz. Söhbət mətn şəklində qeydə alınır.",
        fallback: "Zəng paneli görünmürsə, bələdçidən davam edin.",
      },
      {
        id: DEMO_LIVE_CALL_STEP_ID,
        title: "Telefonunuza zəng",
        instruction:
          "Nömrənizi təsdiqləyin, razılıq verin və «Zəng et» düyməsini basın. LeadDrive-ın AI köməkçisi telefonunuza zəng edəcək.",
        anchor: consent.anchor,
        placement: consent.placement,
        action: "confirm",
        required: true,
        completion: { kind: "outcome", to: DEMO_LIVE_CALL_OUTCOMES },
        covers: [],
        result: "Zəngin nəticəsi liderin kartına yazıldı — nə baş veribsə, onu da göstəririk.",
        analyticsEvent: "journey.transition",
      },
    ],
  }
}

export function withLiveCall(manifest: DemoJourneyManifest): DemoJourneyManifest {
  if (!manifest.sections.some((section) => section.id === DEMO_CALL_SECTION_ID)) return manifest
  return {
    ...manifest,
    // A call needs a phone the prospect has proven; the validator holds that.
    capabilities: { ...manifest.capabilities, liveCall: true, phoneVerification: true },
    sections: manifest.sections.map((section) =>
      section.id === DEMO_CALL_SECTION_ID ? liveCallSection(section) : section,
    ),
  }
}
