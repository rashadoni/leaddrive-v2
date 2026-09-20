import type {
  DemoJourneyAction,
  DemoJourneyManifest,
  DemoJourneyReduceResult,
  DemoJourneySection,
  DemoJourneySnapshot,
  DemoJourneyStep,
} from "@/lib/demo-center/journey"

/**
 * What every scene receives. Scenes render from the snapshot only, dispatch
 * journey actions for real changes, and use `hint` when the prospect clicks
 * something the current step does not ask for. They never fetch.
 */
export interface DemoSceneProps {
  manifest: DemoJourneyManifest
  snapshot: DemoJourneySnapshot
  /** Section displayed (frontier, or an earlier one in review mode). */
  section: DemoJourneySection
  /** Frontier step when it belongs to the displayed section, else null. */
  step: DemoJourneyStep | null
  reviewMode: boolean
  previewMode: boolean
  dispatch: (action: DemoJourneyAction) => DemoJourneyReduceResult
  hint: (message: string) => void
}
