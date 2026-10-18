import type { DemoJourneyManifest, DemoJourneySection } from "./types"
import type { DemoJourneySnapshot } from "./snapshot"

/**
 * The demo's modules — what a prospect picks on the request form and chooses
 * between in the demo (owner, 2026-10-18: «в начале выбирал модуль по модулю…
 * гид спрашивал на какой модуль хочет перейти дальше, показывая доступные
 * модули», and on the form «по умолчанию ИИ-звонки, омни-канал и сделки»).
 *
 * A module is a run of consecutive sections. The lead story crosses four of
 * them (marketing → omni-channel → AI calls → sales), and its state machine
 * still carries the lead from one to the next; but the guide no longer walks
 * the prospect over a module's edge by itself: a module ends on the «what
 * next» screen (`DEMO_NEXT_MODULE_SECTION_ID`), and the prospect chooses.
 * Before, the last step of Service Desk dropped the prospect into Call
 * Center without a word, which the owner read as the demo jumping around.
 *
 * The ids are what `DemoRequest.requestedModules` stores for a guided demo;
 * they never change once a request may carry them.
 */
export const DEMO_JOURNEY_MODULES = [
  {
    id: "marketing",
    title: "Marketinq kampaniyaları",
    pitch: "E-poçt, SMS, WhatsApp və Telegram kampaniyaları, hər birindən gələn sövdələşmələr və pul.",
    sections: ["source"],
  },
  {
    id: "omnichannel",
    title: "Omni-kanal və AI agent",
    pitch: "Bütün kanallardan yazışmalar bir qutuda; AI agent cavab yazır və müştərini lid edir.",
    sections: ["conversation", "ai-reply", "ai-agent-setup", "lead-created", "lead-qualified"],
  },
  {
    id: "ai-calls",
    title: "AI zənglər",
    pitch: "AI agent lidə zəng edir, danışığın nəticəsi kartına yazılır.",
    sections: ["ai-call", "ai-call-result"],
  },
  {
    id: "deals",
    title: "Satış: tapşırıq, sövdələşmə, təklif",
    pitch: "Növbəti addım lövhədə, sövdələşmə mərhələlərlə, kommersiya təklifi bir kliklə.",
    sections: ["task", "deal", "quote", "closed-won"],
  },
  {
    id: "service-desk",
    title: "Service Desk",
    pitch: "Müraciətlər bir növbədə, SLA saatı, AI qaralama və müştərinin təsdiqi ilə bağlanma.",
    sections: ["sd-queue", "sd-ticket", "sd-resolve", "sd-rules", "sd-results"],
  },
  {
    id: "call-center",
    title: "Call Center",
    pitch: "Öz PBX-iniz CRM-də: zəng jurnalı, kartdan zəng və verilən sözün nəzarəti.",
    sections: ["cc-log", "cc-call", "cc-promise"],
  },
  {
    id: "route-field",
    title: "Marşrut & Sahə",
    pitch: "Agentlərin günü: xəritədə marşrut, canlı xəritə, vizitin sübutu və plan-fakt.",
    sections: ["mtm-today", "mtm-plan", "mtm-live", "mtm-visit", "mtm-place", "mtm-results"],
  },
  {
    id: "personnel",
    title: "Kadr uçotu",
    pitch: "Gəliş-çıxış telefondan, müraciətlər, tabel və ay sonu mühasibat üçün.",
    sections: ["prs-today", "prs-timesheet", "prs-risk", "prs-month"],
  },
  {
    id: "contracts",
    title: "Müqavilələr",
    pitch: "Təklifdən müqaviləyə, razılaşma zənciri, elektron imza və müddətlərin nəzarəti.",
    sections: ["ctr-list", "ctr-approve", "ctr-sign", "ctr-control"],
  },
] as const

export type DemoJourneyModuleId = (typeof DEMO_JOURNEY_MODULES)[number]["id"]
export type DemoJourneyModule = (typeof DEMO_JOURNEY_MODULES)[number]

/** Ticked on the request form until the prospect says otherwise. */
export const DEMO_DEFAULT_MODULE_IDS: readonly DemoJourneyModuleId[] = ["omnichannel", "ai-calls", "deals"]

/** The screen every module ends on: «what next?». */
export const DEMO_NEXT_MODULE_SECTION_ID = "next-module"
export const DEMO_NEXT_MODULE_STEP_ID = "next-module-pick"
/** The snapshot path the «Demonu bitir» button sets on that screen. */
export const DEMO_NEXT_MODULE_FINISH_PATH = "next.finish"

const MODULE_IDS = new Set<string>(DEMO_JOURNEY_MODULES.map((module) => module.id))

export function isDemoJourneyModuleId(value: string): value is DemoJourneyModuleId {
  return MODULE_IDS.has(value)
}

const SECTION_MODULE = new Map<string, DemoJourneyModule>(
  DEMO_JOURNEY_MODULES.flatMap((module) => module.sections.map((sectionId) => [sectionId, module] as const)),
)

export function moduleOfSection(sectionId: string): DemoJourneyModule | null {
  return SECTION_MODULE.get(sectionId) ?? null
}

export function getDemoJourneyModule(id: string): DemoJourneyModule | null {
  return DEMO_JOURNEY_MODULES.find((module) => module.id === id) ?? null
}

function walked(section: DemoJourneySection, snapshot: Pick<DemoJourneySnapshot, "completedSteps">): boolean {
  return section.steps.every((step) => !step.required || snapshot.completedSteps.includes(step.id))
}

export interface DemoModuleChoice {
  readonly module: DemoJourneyModule
  /** Where the module opens: its first section in this manifest. */
  readonly firstSectionId: string
  readonly done: boolean
  /** The prospect asked for it on the request form. */
  readonly chosen: boolean
}

/**
 * The modules to choose between, in the order they are offered: the ones the
 * prospect asked for first, then the rest — each group in the order the
 * product tells its story. A module none of whose sections this manifest has
 * is left out.
 */
export function demoModuleChoices(
  manifest: DemoJourneyManifest,
  snapshot: Pick<DemoJourneySnapshot, "completedSteps" | "identity">,
): readonly DemoModuleChoice[] {
  const interests = new Set(snapshot.identity.interests?.length ? snapshot.identity.interests : DEMO_DEFAULT_MODULE_IDS)
  const choices: DemoModuleChoice[] = []
  for (const candidate of DEMO_JOURNEY_MODULES) {
    const sections = manifest.sections.filter((section) => (candidate.sections as readonly string[]).includes(section.id))
    if (!sections.length) continue
    choices.push({
      module: candidate,
      firstSectionId: sections[0].id,
      done: sections.every((section) => walked(section, snapshot)),
      chosen: interests.has(candidate.id),
    })
  }
  return [...choices.filter((choice) => choice.chosen), ...choices.filter((choice) => !choice.chosen)]
}

/** The module the guide suggests next: the first not yet walked, chosen ones first. */
export function suggestedDemoModule(
  manifest: DemoJourneyManifest,
  snapshot: Pick<DemoJourneySnapshot, "completedSteps" | "identity">,
): DemoModuleChoice | null {
  return demoModuleChoices(manifest, snapshot).find((choice) => !choice.done) ?? null
}
