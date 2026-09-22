/**
 * Guided demo journey — versioned scenario contract (Phase A).
 *
 * This module is the pure, framework-free contract for the private guided
 * demo. It replaces the fixed «module → three cards» shape of
 * `src/lib/demo-center/catalog.ts` with a story that runs through real
 * LeadDrive screens: the prospect becomes their own lead and moves it from
 * an inbound conversation to a closed-won deal.
 *
 * Nothing here touches React, Prisma or the network. The renderer (Phase B),
 * the session snapshot (Phase C) and the call workflow (Phase D) consume it;
 * `src/__tests__/demo-journey-manifest.test.ts` keeps it honest.
 */
import type { GroupModuleId } from "@/lib/modules"

/** Product areas a scene can mirror. `shell` and `summary` belong to the demo
 *  itself (orientation and the final screen); the rest are real LeadDrive
 *  pages and are subject to the 80 % coverage rule. */
export const DEMO_JOURNEY_AREAS = [
  "shell",
  "campaigns",
  "inbox",
  "leads",
  "tasks",
  "deals",
  "quotes",
  "summary",
] as const
export type DemoJourneyArea = (typeof DEMO_JOURNEY_AREAS)[number]

export const DEMO_PRODUCT_AREAS: readonly DemoJourneyArea[] = [
  "campaigns", "inbox", "leads", "tasks", "deals", "quotes",
]

/** Capabilities a grant can switch on. Everything except email verification
 *  is off in v1: the phone/call pair waits for Phase D and owner decisions,
 *  narration for approved audio, the assistant for a model/cost decision. */
export const DEMO_CAPABILITY_IDS = [
  "emailVerification",
  "phoneVerification",
  "liveCall",
  "video",
  "narration",
  "assistant",
] as const
export type DemoCapabilityId = (typeof DEMO_CAPABILITY_IDS)[number]
export type DemoCapabilities = Readonly<Record<DemoCapabilityId, boolean>>

/** Journey states. The happy path is linear; the CALL_* alternatives keep the
 *  non-call path completable (declined, blocked or failed calls all continue
 *  to the task step, truthfully labelled). EXPIRED / REVOKED are reachable
 *  from any non-terminal state — see `state.ts`. */
export const DEMO_JOURNEY_STATES = [
  "PREPARED",
  "STARTED",
  "SOURCE_SEEN",
  "CONVERSATION_OPENED",
  "AI_REPLIED",
  "LEAD_CREATED",
  "LEAD_QUALIFIED",
  "CALL_SKIPPED",
  "CALL_DECLINED",
  "CALL_QUEUED",
  "CALLING",
  "CALL_RESULT_RECORDED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_BLOCKED",
  "CALL_FAILED",
  "CALL_ATTENTION_REQUIRED",
  "TASK_CREATED",
  "DEAL_CREATED",
  "DEAL_ADVANCED",
  "QUOTE_CREATED",
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "CLOSED_WON",
  "COMPLETED",
  "EXPIRED",
  "REVOKED",
] as const
export type DemoJourneyState = (typeof DEMO_JOURNEY_STATES)[number]

export const DEMO_STEP_ACTIONS = ["observe", "click", "type", "choose", "drag", "confirm", "wait"] as const
export type DemoStepAction = (typeof DEMO_STEP_ACTIONS)[number]

export const DEMO_STEP_PLACEMENTS = ["auto", "top", "bottom", "left", "right"] as const
export type DemoStepPlacement = (typeof DEMO_STEP_PLACEMENTS)[number]

/** Analytics vocabulary the renderer may emit. Phase B/C extends the public
 *  events route (`demoEventSchema`) to accept these; until then the names are
 *  a contract only. */
export const DEMO_JOURNEY_EVENTS = [
  "journey.started",
  "journey.section_opened",
  "journey.step_viewed",
  "journey.step_completed",
  "journey.step_skipped",
  "journey.transition",
  "journey.completed",
  "video.started",
  "video.completed",
  "video.skipped",
  "video.replayed",
  "video.error",
  "assistant.opened",
  "assistant.asked",
  "call.consent_shown",
  "call.declined",
  "call.queued",
  "call.result",
  "anchor.missing",
] as const
export type DemoJourneyEvent = (typeof DEMO_JOURNEY_EVENTS)[number]

/**
 * How a step is considered done. `viewed` closes on «Next» and is only valid
 * for `observe`/`wait`. `transition` requires the journey state to move —
 * the renderer may not tick the step by itself (the Salesforce audit's I07:
 * «Complete» without the action happening is exactly what we refuse to
 * copy). `snapshot` requires a field of the session snapshot to hold a value
 * (a tab switched, a record field changed) without moving the journey state.
 *
 * `outcome` is for a step whose result the demo does not decide: the real
 * world does. A live AI call can be answered, missed, busy, refused by the
 * policy, or left uncertain, and the story must record which one happened
 * rather than pretend. The step closes on any listed state, reached along a
 * legal path of transitions (queued → calling → answered), and every listed
 * state must end the section. The first entry is the story's own ending.
 */
export type DemoCompletionRule =
  | { readonly kind: "viewed" }
  | { readonly kind: "transition"; readonly to: DemoJourneyState }
  | { readonly kind: "snapshot"; readonly path: string; readonly equals: string | number | boolean }
  | { readonly kind: "outcome"; readonly to: readonly DemoJourneyState[] }

/**
 * A short clip from the existing help-video pipeline
 * (`video/player/<slug>.az.VOICE.mp4` + `.poster.jpg`). `available` clips must
 * exist on disk; `planned` ones are produced in Phase F with approved audio.
 * Completion never depends on the clip: it is an intro, not the step.
 */
export interface DemoTourClip {
  readonly slug: string
  readonly caption: string
  readonly status: "available" | "planned"
}

export interface DemoJourneyStep {
  /** Stable kebab-case id, unique across the manifest. */
  readonly id: string
  readonly title: string
  /** What the prospect should do or look at — natural Azerbaijani. */
  readonly instruction: string
  /** `data-demo-anchor` / `data-tour-id` the coach mark attaches to. */
  readonly anchor: string
  readonly placement: DemoStepPlacement
  readonly action: DemoStepAction
  /**
   * Words on the on-screen arrow, verb first («Kampaniyanı açın»). Every step
   * the prospect acts on has one: the arrow points at the exact control
   * marked `data-demo-target="<step id>"` and stays when the card is put
   * away (owner, 2026-09-22: «стрелками показывать, что надо сделать»).
   */
  readonly targetLabel?: string
  readonly required: boolean
  readonly completion: DemoCompletionRule
  /** Coverage-inventory section ids this step demonstrates (`<area>.<section>`). */
  readonly covers: readonly string[]
  /** Visible result after a completed action («Nəticə»). */
  readonly result?: string
  /** Shown when the anchor does not render or motion is reduced. */
  readonly fallback?: string
  readonly analyticsEvent: DemoJourneyEvent
}

export interface DemoJourneySection {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly area: DemoJourneyArea
  /** The real LeadDrive route the scene mirrors (`/inbox`, `/leads/[id]`…);
   *  `demo:` routes belong to the demo shell itself. */
  readonly route: string
  /** Sidebar group that must be visible for this scene. */
  readonly navGroup: GroupModuleId | "demo"
  readonly estimatedMinutes: number
  /** Capabilities the section needs; sections whose requirements are not
   *  granted are skipped with their `skippedNotice`. */
  readonly requires: readonly DemoCapabilityId[]
  readonly skippedNotice?: string
  readonly entryStates: readonly DemoJourneyState[]
  readonly exitStates: readonly DemoJourneyState[]
  readonly intro?: DemoTourClip
  /** Questions the prospect may ask the assistant here (hidden unless the
   *  `assistant` capability is granted). */
  readonly assistantPrompts?: readonly string[]
  readonly steps: readonly DemoJourneyStep[]
}

export interface DemoJourneyManifest {
  readonly scenarioId: string
  readonly version: number
  readonly locale: "az"
  readonly title: string
  readonly summary: string
  /** Sidebar groups the prospect sees. Every other group is hidden by the
   *  grant, the same way tenant modules hide groups today. */
  readonly navGroups: readonly GroupModuleId[]
  /** Exact routes the reduced sidebar shows — the prospect never sees more. */
  readonly visibleRoutes: readonly string[]
  readonly capabilities: DemoCapabilities
  readonly estimatedMinutes: number
  readonly sections: readonly DemoJourneySection[]
}
