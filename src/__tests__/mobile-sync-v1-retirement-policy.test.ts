import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const runbook = readFileSync(join(process.cwd(), "docs/mobile-sync-v2-rollout-runbook.md"), "utf8")
const plan = readFileSync(join(process.cwd(), "docs/mobile-sync-scalability-plan-2026-08-28.md"), "utf8")

describe("S7 v1 retirement policy", () => {
  it("pins the owner-approved compatibility and active-fleet gates", () => {
    expect(runbook).toContain("mandatoryUpdateAvailableAt")
    expect(runbook).toMatch(/90 full UTC days/)
    expect(runbook).toMatch(/30 consecutive full UTC\s+days/)
    expect(runbook).toContain("end of the 120th full UTC day")
    expect(runbook).toContain("150 days")
    expect(runbook).toContain("mobile_apk_observed")
    expect(runbook).toContain("mobile_sync_v1_activity")
    expect(runbook).toContain("unregistered or unsupported release-ledger claim")
    expect(runbook).toContain("regardless of its APK claim")
    expect(runbook).toContain("protocolPreferred: 1")
    expect(runbook).toContain("426 upgrade_required")
    expect(runbook).toContain("current v2 is read-only")
    expect(plan).toContain("90 полных UTC-дней v1 compatibility")
  })
})
