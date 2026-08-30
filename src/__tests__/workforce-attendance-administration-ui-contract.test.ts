import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const administration = readFileSync("src/components/workforce/workforce-attendance-administration.tsx", "utf8")
const configurationPage = readFileSync("src/app/(dashboard)/workforce/configuration/page.tsx", "utf8")

describe("Workforce attendance administration UI boundary", () => {
  it("mounts the security surface in Workforce configuration", () => {
    expect(configurationPage).toContain("WorkforceAttendanceAdministration")
  })

  it("uses short-lived QR image data without rendering sensitive device proof material", () => {
    expect(administration).toContain("qrDataUrl")
    expect(administration).toContain("<Image")
    expect(administration).not.toContain("publicKeySpki")
    expect(administration).not.toContain("publicKeyFingerprint")
    expect(administration).not.toContain("deviceAttestation")
  })

  it("limits device lifecycle actions to verified pending approval and active revocation", () => {
    expect(administration).toContain('device.status === "PENDING" && device.keyVerifiedAt')
    expect(administration).toContain('device.status === "ACTIVE"')
    expect(administration).toContain('operation: "approve" | "revoke"')
    expect(administration).toContain('/${operation}')
  })
})
