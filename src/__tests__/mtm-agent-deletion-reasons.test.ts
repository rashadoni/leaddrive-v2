import { expect, it } from "vitest"
import { agentDeletionReasons } from "@/lib/mtm/agent-deletion-reasons"

it("keeps GPS distinct from attendance when the retention guard reports its source", () => {
  expect(agentDeletionReasons("WORKFORCE_RETENTION_BLOCKED", ["MtmAgentLocation.agentId"])).toEqual(["location"])
  expect(agentDeletionReasons("WORKFORCE_RETENTION_BLOCKED", undefined)).toEqual(["time"])
})

it("never turns an unknown relation or raw database diagnostic into user-visible text", () => {
  expect(agentDeletionReasons("MTM_AGENT_HAS_HISTORY", ["MtmVisit.agentId", "MtmVisitParticipant.agentId", "private error", null, "FutureModel.agentId"]))
    .toEqual(["visits", "other"])
  expect(agentDeletionReasons("MTM_AGENT_DELETE_DEPENDENCY", ["MtmVisit.agentId"])).toEqual(["dependency"])
})
