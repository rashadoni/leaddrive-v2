import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const contract = readFileSync(
  join(root, "docs/workforce-c12-slo-contract-2026-09-13.md"),
  "utf8",
).replace(/\s+/g, " ")
const loadScenario = readFileSync(
  join(root, "tests/load/scenarios/workforce-morning-start.js"),
  "utf8",
)

describe("Workforce release-one SLO contract", () => {
  it("pins the accepted latency, pending-age and zero-loss boundaries", () => {
    expect(contract).toContain("p95 <= 10 seconds and p99 <= 20 seconds")
    expect(contract).toContain(">= 2 minutes for 5 minutes")
    expect(contract).toContain(">= 15 minutes")
    expect(contract).toContain("zero accepted attendance business events")
    expect(contract).toContain("permits no automatic repair")
    expect(loadScenario).toContain('threshold: "p(95)<10000"')
    expect(loadScenario).toContain('threshold: "p(99)<20000"')
    expect(loadScenario).toContain('threshold: "count==0"')
  })

  it("records accountable recovery and privacy-safe evidence", () => {
    for (const owner of ["SRE", "Product", "HR", "Security/Privacy"]) {
      expect(contract, owner).toContain(owner)
    }
    expect(contract).toContain("RPO:** zero")
    expect(contract).toContain("RTO:** within 30 minutes")
    expect(contract).toContain("keeping read/reconciliation access")
    expect(contract).toContain("excludes employee IDs, coordinates, QR values")
    expect(contract).toContain("does not claim that external load")
  })

  it("links only maintained recovery and escalation runbooks", () => {
    for (const path of [
      "docs/workforce-pilot-rollback-retention-runbook-2026-08-28.md",
      "docs/workforce-sync-support-playbook.md",
      "docs/workforce-c10-privacy-security-incident-runbook-2026-08-30.md",
      "docs/workforce-h6-pilot-evidence.md",
    ]) {
      expect(existsSync(join(root, path)), path).toBe(true)
      expect(contract, path).toContain(path)
    }
  })
})
