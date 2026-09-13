import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const playbookPath = "docs/workforce-device-access-recovery-playbooks-2026-09-13.md"
const playbook = readFileSync(join(root, playbookPath), "utf8").replace(/\s+/g, " ")

const sourceBackedPaths = [
  "src/lib/workforce/attendance-management.ts",
  "src/lib/workforce/mobile-write-fence.ts",
  "src/lib/workforce/employment-history.ts",
  "src/lib/workforce/access-control.ts",
  "src/lib/workforce/exception-case-writer.ts",
  "docs/workforce-c10-privacy-security-incident-runbook-2026-08-30.md",
] as const

describe("Workforce device and access recovery playbooks", () => {
  it("points only to maintained containment and immutable-history foundations", () => {
    for (const path of sourceBackedPaths) expect(existsSync(join(root, path)), path).toBe(true)
    expect(playbook).toContain("Self-revoke is intentionally permitted")
    expect(playbook).toContain("self-approval of a replacement is forbidden")
    expect(playbook).toContain("Routes remain a separate module")
    expect(playbook).toContain("never overwrites the original fact")
  })

  it("keeps recovery narrow, privacy-safe and honest about external evidence", () => {
    expect(playbook).toContain("Do not globally freeze Workforce")
    expect(playbook).toContain("Do not revoke unrelated employee devices")
    expect(playbook).toContain("Do not copy a raw QR, GPS coordinate")
    expect(playbook).toContain("measured end-to-end termination/rehire exercise is **NOT RUN**")
    expect(playbook).toContain("WF-C5-012 DONE; external exercises NOT RUN")
    expect(playbook).toContain("WF-C14-004")
    expect(playbook).toContain("WF-C14-006")
    expect(playbook).toContain("WF-C14-007")
  })

  it("requires measurable rejection, audit, reconciliation and rollback outcomes", () => {
    for (const evidence of [
      "start and containment times",
      "expected and actual rejection codes",
      "retained audit references",
      "reconciliation result",
      "rollback outcome",
    ]) expect(playbook, evidence).toContain(evidence)
    expect(playbook).toContain("no duplicate or lost canonical workday event")
  })
})
