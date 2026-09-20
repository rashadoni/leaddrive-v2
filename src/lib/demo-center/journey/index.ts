export * from "./types"
export * from "./state"
export * from "./anchors"
export * from "./coverage"
export * from "./records"
export * from "./snapshot"
export { DEMO_PRODUCT_AREAS_WITH_COVERAGE } from "./coverage-index"
export { validateJourneyManifest } from "./validate"
export { PROSPECT_TO_CLOSED_WON } from "./prospect-to-closed-won"

import { PROSPECT_TO_CLOSED_WON } from "./prospect-to-closed-won"
import type { DemoJourneyManifest } from "./types"

/** Approved scenarios by id. v1 ships exactly one; the admin picker (Phase G)
 *  lists this map, never a free-form scenario from the browser. */
export const DEMO_JOURNEY_SCENARIOS: Readonly<Record<string, DemoJourneyManifest>> = {
  [PROSPECT_TO_CLOSED_WON.scenarioId]: PROSPECT_TO_CLOSED_WON,
}

export function getDemoJourneyScenario(scenarioId: string): DemoJourneyManifest | null {
  return Object.prototype.hasOwnProperty.call(DEMO_JOURNEY_SCENARIOS, scenarioId)
    ? DEMO_JOURNEY_SCENARIOS[scenarioId]
    : null
}
