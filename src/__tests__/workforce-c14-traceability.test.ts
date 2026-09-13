import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const register = readFileSync(
  join(root, "docs/workforce-c14-verification-traceability-2026-09-13.md"),
  "utf8",
)

const matrix = {
  time: [
    "src/__tests__/lib-mtm-workday.test.ts",
    "src/__tests__/workforce-timesheet-calculation.test.ts",
    "src/__tests__/workforce-workday-facts-replay.test.ts",
  ],
  schedules: [
    "src/__tests__/workforce-calendar.test.ts",
    "src/__tests__/workforce-shift-resolution.test.ts",
    "src/__tests__/workforce-policy-resolution.test.ts",
  ],
  geofence: [
    "src/__tests__/workforce-geofence-evaluation.test.ts",
    "src/__tests__/workforce-gps-edge-matrix.test.ts",
    "src/__tests__/workforce-location-evidence-policy.test.ts",
  ],
  evidence: [
    "src/__tests__/workforce-evidence-envelope.test.ts",
    "src/__tests__/workforce-proof-policy.test.ts",
    "src/__tests__/workforce-evidence-storage.test.ts",
  ],
  assessment: [
    "src/__tests__/workforce-attendance-trust.test.ts",
    "src/__tests__/workforce-attendance-risk-signals.test.ts",
    "src/__tests__/workforce-assessment-explanation.test.ts",
  ],
  exceptions: [
    "src/__tests__/lib-workforce-exception-intake.test.ts",
    "src/__tests__/lib-workforce-no-show-candidate.test.ts",
    "src/__tests__/lib-workforce-missed-finish-candidate.test.ts",
    "src/__tests__/lib-workforce-exception-case-ledger.test.ts",
  ],
  retention: [
    "src/__tests__/workforce-raw-location-retention.test.ts",
    "src/__tests__/workforce-retention-guard.test.ts",
    "src/__tests__/workforce-time-decision-retention.test.ts",
  ],
  approvals: [
    "src/__tests__/workforce-timesheet-approval.test.ts",
    "src/__tests__/workforce-timesheet-approval-service.test.ts",
    "src/__tests__/workforce-timesheet-export.test.ts",
    "src/__tests__/workforce-timesheet-rehydration.test.ts",
  ],
} as const

describe("Workforce C14 verification traceability", () => {
  it("keeps all required calculation domains mapped to multiple tests", () => {
    expect(Object.keys(matrix)).toEqual([
      "time",
      "schedules",
      "geofence",
      "evidence",
      "assessment",
      "exceptions",
      "retention",
      "approvals",
    ])
    for (const paths of Object.values(matrix)) {
      expect(new Set(paths).size).toBe(paths.length)
      expect(paths.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("keeps every registered path documented and executable", () => {
    for (const paths of Object.values(matrix)) {
      for (const path of paths) {
        expect(register, path).toContain(`\`${path}\``)
        const source = readFileSync(join(root, path), "utf8")
        expect(path).toMatch(/\.test\.ts$/)
        expect(source, path).toMatch(/\bdescribe\s*\(/)
        expect(source, path).toMatch(/\b(?:it|test)(?:\.each)?\s*\(/)
      }
    }
  })

  it("does not turn source coverage into physical evidence", () => {
    expect(register).toContain("not evidence of a signed-device run")
    expect(register).toMatch(/do not prove that a\s+specific Android build/)
    expect(register).toContain("WF-C14-004")
    expect(register).toContain("WF-C14-006")
    expect(register).toContain("WF-C14-007")
    expect(register).toContain("WF-C14-009")
  })
})
