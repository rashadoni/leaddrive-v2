import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const component = readFileSync(resolve(process.cwd(), "src/components/workforce/workforce-exception-report.tsx"), "utf8")
const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/workforce/exceptions/report/page.tsx"), "utf8")
const queue = readFileSync(resolve(process.cwd(), "src/components/workforce/workforce-exception-queue.tsx"), "utf8")

describe("Workforce exception aggregate report UI contract", () => {
  it("keeps the aggregate a separate, date-filtered HR surface", () => {
    expect(page).toContain("<WorkforceExceptionReport />")
    expect(component).toContain('fetch(`/api/v1/workforce/exception-reports${suffix}`')
    expect(component).toContain('data-testid="workforce-exception-report-boundary"')
    expect(component).toContain('type="date"')
    expect(queue).toContain('href="/workforce/exceptions/report"')
  })

  it("does not render a case/employee/proof detail row in the aggregate report", () => {
    expect(component).not.toMatch(/employeeDisplayName|displayReference|rawLocation|qrPayload|decisionReason|evidenceId/)
    expect(component).toContain('CASE_RECORDED_AT')
    expect(component).toContain('t("boundaryTitle")')
  })

  it("defers exception-review access to the server's granular Workforce grant", () => {
    for (const source of [component, queue]) {
      expect(source).not.toContain('const isAdmin = role === "admin" || role === "superadmin"')
      expect(source).toContain("if (response.status === 403)")
      expect(source).toContain("setAccessDeniedRequestKey(requestKey)")
    }
  })

  it("keeps untrusted queue enums in local unavailable copy", () => {
    for (const source of [component, queue]) {
      expect(source).toContain('workforceExceptionQueueLabelKey(')
      expect(source).not.toContain('t(`types.${item.type}`)')
    }
  })
})
