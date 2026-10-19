import {
  awaitingOutcome,
  getDemoJourneyModule,
  isDemoJourneyModuleId,
  moduleFirstSectionId,
  moduleOfSection,
  sectionJumpTarget,
  type DemoJourneyManifest,
  type DemoJourneyModuleId,
  type DemoJourneySnapshot,
} from "@/lib/demo-center/journey"

/**
 * What an assistant answer may do on the prospect's screen — the guide's
 * «hands» (owner, 2026-10-18: «если что-то спросит клиент, он смог сразу
 * перенаправить, открыть для него, подсказать»).
 *
 * A closed list: open a module at its beginning, exactly as the sidebar or a
 * «Növbəti modul» card does, or bring the current step's card and arrow back.
 * The server only names ids from it; the browser parses the answer again with
 * `parseDemoAssistantAction` and plans it against its own, latest position
 * with `planAssistantAction`, through the same jump rules as every other
 * jump (`sectionJumpTarget`). Nothing here can complete or skip a step, press
 * a control, end the demo or open the story's own screens — the fuzz test in
 * demo-assistant-actions.test.ts walks every position to prove it.
 *
 * Pure: imports only the journey, like the rest of this directory.
 */

export type DemoAssistantAction =
  | { readonly kind: "open_module"; readonly moduleId: DemoJourneyModuleId }
  | { readonly kind: "point_step" }

export type DemoAssistantPlan =
  | { readonly kind: "open"; readonly sectionId: string; readonly moduleTitle: string }
  | { readonly kind: "point" }
  | { readonly kind: "refused"; readonly reason: "waits_for_call" | "refused" }

/** The action in an answer, or null for anything that is not exactly one of the list. */
export function parseDemoAssistantAction(raw: unknown): DemoAssistantAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort().join(",")
  if (value.kind === "point_step" && keys === "kind") return { kind: "point_step" }
  if (value.kind === "open_module" && keys === "kind,moduleId" && typeof value.moduleId === "string" && isDemoJourneyModuleId(value.moduleId)) {
    return { kind: "open_module", moduleId: value.moduleId }
  }
  return null
}

/**
 * What the action does from this position, or null when it does nothing here
 * (a module this story does not have). Asked for the module the prospect is
 * already in, it opens nothing — nothing restarts under their hands — and
 * shows the current step instead.
 */
export function planAssistantAction(
  action: DemoAssistantAction,
  snapshot: DemoJourneySnapshot,
  manifest: DemoJourneyManifest,
): DemoAssistantPlan | null {
  if (action.kind === "point_step") return { kind: "point" }
  const module = getDemoJourneyModule(action.moduleId)
  const firstSectionId = moduleFirstSectionId(manifest, action.moduleId)
  if (!module || !firstSectionId) return null
  if (moduleOfSection(snapshot.sectionId)?.id === module.id) return { kind: "point" }
  const jump = sectionJumpTarget(snapshot, manifest, firstSectionId)
  if (!jump.ok) return { kind: "refused", reason: awaitingOutcome(snapshot, manifest) ? "waits_for_call" : "refused" }
  return { kind: "open", sectionId: firstSectionId, moduleTitle: module.title }
}
