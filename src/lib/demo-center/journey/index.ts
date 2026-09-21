export * from "./types"
export * from "./state"
export * from "./anchors"
export * from "./coverage"
export * from "./records"
export * from "./snapshot"
export { DEMO_PRODUCT_AREAS_WITH_COVERAGE } from "./coverage-index"
export { validateJourneyManifest } from "./validate"
export { PROSPECT_TO_CLOSED_WON } from "./prospect-to-closed-won"
export * from "./live-call"
export * from "./telemetry"

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

/**
 * Clip slugs any approved scenario may play. The capability-gated video
 * route serves nothing outside this set, so a demo link cannot be turned
 * into a general-purpose CDN for the whole help-video library.
 */
export function demoJourneyClipSlugs(): ReadonlySet<string> {
  const slugs = new Set<string>()
  for (const manifest of Object.values(DEMO_JOURNEY_SCENARIOS)) {
    if (!manifest.capabilities.video) continue
    for (const section of manifest.sections) {
      if (section.intro) slugs.add(section.intro.slug)
    }
  }
  return slugs
}
