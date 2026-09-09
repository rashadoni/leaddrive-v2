import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const contract = readFileSync(join(
  process.cwd(), "docs/mobile-sync-v2-visits-tasks-contract.md"), "utf8")

describe("MTM mobile sync v2 visits/tasks contract", () => {
  it("pins the primary-only, PII/GPS/media-free additive read contract", () => {
    expect(contract).toContain("Only `MtmVisit.agentId` equal to the authenticated Field agent")
    expect(contract).toContain("Only `MtmTask.agentId` equal to the authenticated Field agent")
    expect(contract).toContain("Customer/contact IDs and names, all GPS")
    expect(contract).toContain("title/description, result/return reason")
    expect(contract).toContain("participant workspace remains the v1 on-demand endpoint")
    expect(contract).toContain("Protocol v1 remains the sole mutation authority")
  })

  it("pins independent cohorts, opaque cursors and stream-local recovery", () => {
    expect(contract).toContain("exact, enabled, non-expired `mtm_mobile_sync_cohorts` row")
    expect(contract).toContain("cursor binds tenant, primary agent, device, stream")
    expect(contract).toContain("rebuild only this stream")
    expect(contract).toContain("Field outbox, local media and other cursors are never cleared")
    expect(contract).toContain("Rollback disables only the exact `visits` or `tasks` cohort")
  })
})
