import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const admin = readFileSync(join(root, "docs/workforce-administrator-guide.md"), "utf8")
const employee = readFileSync(join(root, "docs/workforce-employee-guide.md"), "utf8")
const adminText = admin.replace(/\s+/g, " ")
const employeeText = employee.replace(/\s+/g, " ")

const pages = [
  "src/app/(dashboard)/workforce/page.tsx",
  "src/app/(dashboard)/workforce/timesheet/page.tsx",
  "src/app/(dashboard)/workforce/requests/page.tsx",
  "src/app/(dashboard)/workforce/exceptions/page.tsx",
  "src/app/(dashboard)/workforce/exceptions/mine/page.tsx",
  "src/app/(dashboard)/workforce/configuration/page.tsx",
  "src/app/(dashboard)/workforce/reports/page.tsx",
  "src/app/(dashboard)/workforce/reports/site-transitions/page.tsx",
] as const

const runbooks = [
  "docs/workforce-sync-support-playbook.md",
  "docs/workforce-c10-privacy-security-incident-runbook-2026-08-30.md",
  "docs/workforce-pilot-rollback-retention-runbook-2026-08-28.md",
] as const

describe("Workforce help guides", () => {
  it("references only current Workforce pages and maintained recovery runbooks", () => {
    for (const path of [...pages, ...runbooks]) expect(existsSync(join(root, path)), path).toBe(true)
    for (const route of [
      "/workforce",
      "/workforce/timesheet",
      "/workforce/requests",
      "/workforce/exceptions",
      "/workforce/exceptions/mine",
      "/workforce/configuration",
      "/workforce/reports",
      "/workforce/reports/site-transitions",
    ]) {
      expect(admin + employee, route).toContain(`\`${route}\``)
    }
    for (const path of runbooks) {
      const filename = path.split("/").at(-1)
      expect(admin + employee, path).toContain(`./${filename}`)
    }
  })

  it("keeps employee and administrator promises inside verified boundaries", () => {
    expect(adminText).toContain("does not describe Route & Field, payroll, background employee tracking")
    expect(adminText).toContain("not proof of identity or physical presence")
    expect(adminText).toContain("Do not delete history, restore/drop a database, mass-enable a cohort")
    expect(employeeText).toContain("not yet verified")
    expect(employeeText).toContain("None alone proves")
    expect(employeeText).toContain("Neither process authorizes automatic payroll or disciplinary action")
  })

  it("keeps the approved LeadDrive default explicit without activating it from documentation", () => {
    expect(adminText).toContain("Monday-Friday, 09:00-18:00, eight expected")
    expect(adminText).toContain("13:00-14:00 planned break")
    expect(adminText).toContain("15-minute late grace")
    expect(adminText).toContain("unless a reviewed tenant policy says otherwise")
  })
})
