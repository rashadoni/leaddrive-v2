import { getDemoJourneyScenario, PROSPECT_TO_CLOSED_WON, withLiveCall, type DemoJourneyManifest } from "@/lib/demo-center/journey"

/**
 * The story a grant walks: its scenario, with the live AI call when the grant
 * has one. The same resolution the event route checks reports against, so the
 * assistant reads the very steps the prospect is on — before this, a grant
 * with the live call asked about the call step got the first screen's answer.
 * A grant whose scenario is gone walks the default story.
 */
export function demoGrantManifest(grant: { scenarioId: string | null; liveCallEnabled: boolean }): DemoJourneyManifest {
  const scenario = (grant.scenarioId ? getDemoJourneyScenario(grant.scenarioId) : null) ?? PROSPECT_TO_CLOSED_WON
  return grant.liveCallEnabled ? withLiveCall(scenario) : scenario
}
