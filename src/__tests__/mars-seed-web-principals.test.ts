import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("scripts/seeds/mars.mjs", "utf8")

describe("Mars demo seed web principals", () => {
  it("creates a tenant-scoped CRM principal for every non-manager roster entry", () => {
    expect(source).toContain("if (!a.isManager)")
    expect(source).toContain("organizationId_email: { organizationId: orgId, email: a.email }")
    expect(source).toContain('const webRole = a.role === "SUPERVISOR" ? "manager" : "sales"')
    expect(source).toContain("linkedUserId = webUser.id")
    expect(source.match(/userId: linkedUserId/g)).toHaveLength(2)
  })

  it("does not rotate existing CRM passwords unless explicitly requested", () => {
    expect(source).toContain("...(RESET_PASSWORDS")
    expect(source).toContain("passwordChangedAt: new Date()")
    expect(source).toContain("passwordHash: demoPasswordHash")
  })
})
