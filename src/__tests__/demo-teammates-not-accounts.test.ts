/**
 * Demo teammates are scenery, not accounts (scripts/demo-teammates.mjs).
 *
 * 2026-11-08: the tenant demo seed had made Sarah Johnson (manager), Alex Chen
 * and Maria Lopez ACTIVE users on `<slug>.com` with the admin's welcome
 * password, in ATS Food, Biznesdoktor and Service Desk. Those domains belong
 * to strangers or to nobody (biznesdoktor.com unregistered, atsfood.com for
 * sale), so «Забыли пароль?» to sarah@<slug>.com handed a client's CRM to
 * whoever holds the domain. Alex and Maria also had the role "member", which
 * no permission check knows.
 */
import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import bcrypt from "bcryptjs"
// @ts-expect-error — plain .mjs script module, no type declarations
import { demoTeammateData, demoTeammateEmail, DEMO_TEAMMATE_ROLES } from "../../scripts/demo-teammates.mjs"
import { getAssignableRoleIds } from "@/lib/org-roles"
import { checkPermission } from "@/lib/permissions"

const SEED_PASSWORD = "Welcome-Temp-2026-xyz!"
const hash = (secret: string) => bcrypt.hash(secret, 4)

describe("a demo teammate", () => {
  it("cannot sign in: inactive, undeliverable address, a password nobody holds", async () => {
    const data = await demoTeammateData({ name: "Sarah Johnson", localPart: "sarah", role: "manager" }, "biznesdoktor", hash)
    expect(data).toMatchObject({ name: "Sarah Johnson", role: "manager", isActive: false })
    expect(data.email).toBe("sarah@biznesdoktor.demo.invalid")
    // Not the seed's (= the admin's welcome) password.
    expect(await bcrypt.compare(SEED_PASSWORD, data.passwordHash)).toBe(false)
    // And not the same secret twice.
    const again = await demoTeammateData({ name: "Sarah Johnson", localPart: "sarah", role: "manager" }, "biznesdoktor", hash)
    expect(again.passwordHash).not.toBe(data.passwordHash)
  })

  it("only ever lands on the reserved .invalid TLD, whatever the slug", () => {
    for (const slug of ["biznesdoktor", "ATS Food", "service-desk", "../evil.com", "x@y"]) {
      const email = demoTeammateEmail("alex", slug)
      expect(email, slug).toMatch(/^alex@[a-z0-9-]+\.demo\.invalid$/)
    }
    expect(demoTeammateEmail("tural.mammadov", "afigroup")).toBe("tural.mammadov@afigroup.demo.invalid")
  })

  it("holds a role the permission matrix enforces, and never «member»", async () => {
    for (const role of DEMO_TEAMMATE_ROLES) {
      expect(getAssignableRoleIds().has(role), role).toBe(true)
      expect(checkPermission(role as never, "deals", "read"), role).toBe(true)
    }
    await expect(demoTeammateData({ name: "x", localPart: "x", role: "member" }, "s", hash)).rejects.toThrow(/not an enforced role/)
  })
})

describe("every seed that adds teammates goes through it", () => {
  for (const file of ["scripts/seed-tenant-demo.mjs", "scripts/seeds/afigroup.mjs"]) {
    const src = readFileSync(file, "utf8")
    it(file, () => {
      expect(src).toContain("demoTeammateData(")
      expect(src).not.toMatch(/role:\s*"member"\s*}/)
      expect(src).not.toMatch(/@\$\{slug\}\.com/)
      expect(src).not.toMatch(/roleId:\s*"member"|sourceRole:\s*"member"|targetRole:\s*"member"/)
    })
  }
})
