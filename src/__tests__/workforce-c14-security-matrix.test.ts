import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const register = readFileSync(join(root, "docs/workforce-c14-security-matrix-2026-09-13.md"), "utf8")

const lanes = {
  tenantRls: [
    "src/__tests__/with-workforce-rls-auth.test.ts",
    "src/__tests__/api-workforce-attendance.test.ts",
    "src/__tests__/lib-workforce-access-grant-resolution.test.ts",
  ],
  roleIdor: [
    "src/__tests__/lib-workforce-access-control.test.ts",
    "src/__tests__/api-workforce-site-transition-reports.test.ts",
    "src/__tests__/api-workforce-timesheet-approvals.test.ts",
  ],
  replayBackdating: [
    "src/__tests__/lib-mtm-workday.test.ts",
    "src/__tests__/workforce-site-transition-facts.test.ts",
    "src/__tests__/workforce-attendance-trust.test.ts",
  ],
  qrRelay: [
    "src/__tests__/workforce-attendance-security.test.ts",
    "src/__tests__/workforce-attendance-trust.test.ts",
  ],
  gpsSpoof: [
    "src/__tests__/workforce-location-evidence-policy.test.ts",
    "src/__tests__/workforce-gps-edge-matrix.test.ts",
    "src/__tests__/workforce-attendance-risk-signals.test.ts",
  ],
  attestationBiometric: [
    "src/__tests__/workforce-attendance-security.test.ts",
    "src/__tests__/workforce-attendance-trust.test.ts",
  ],
  adminAbuse: [
    "src/__tests__/workforce-attendance-management.test.ts",
    "src/__tests__/workforce-attendance-security-mfa.test.ts",
    "src/__tests__/workforce-mobile-write-fence.test.ts",
  ],
} as const

describe("Workforce C14 security matrix", () => {
  it("keeps every required threat lane mapped to executable tests", () => {
    expect(Object.keys(lanes)).toEqual([
      "tenantRls",
      "roleIdor",
      "replayBackdating",
      "qrRelay",
      "gpsSpoof",
      "attestationBiometric",
      "adminAbuse",
    ])
    for (const paths of Object.values(lanes)) {
      expect(paths.length).toBeGreaterThanOrEqual(2)
      for (const path of paths) {
        expect(register, path).toContain(`\`${path}\``)
        const source = readFileSync(join(root, path), "utf8")
        expect(source, path).toMatch(/\bdescribe\s*\(/)
        expect(source, path).toMatch(/\b(?:it|test)(?:\.each)?\s*\(/)
      }
    }
  })

  it("retains the unresolved real-world security boundary", () => {
    expect(register).toContain("photographed/relayed valid QR remains a documented residual risk")
    expect(register).toContain("No physical hardware-backed attestation chain")
    expect(register).toContain("production RLS or a signed-device")
    expect(register).toContain("WF-C14-002` remains `PARTIAL")
  })
})
