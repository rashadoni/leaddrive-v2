import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM route approval evidence UI contract", () => {
  const queue = source("src/components/mtm/route-approval-queue.tsx")
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")

  it("keeps the existing queues and adds evidence to each route request", () => {
    expect(routesPage).toContain("<MtmRouteApprovalQueue")
    expect(routesPage).toContain("<MtmCustomerRequestQueue")
    expect(queue).toContain("request.evidence")
    expect(queue).toContain('t("changeEvidenceBefore")')
    expect(queue).toContain('t("changeEvidenceAfter")')
    expect(queue).toContain('t("changeEvidenceLegacy")')
  })

  it("keeps decisions explicit and does not add an unsafe automatic undo", () => {
    expect(queue).toContain('decide(request.id, "APPROVED")')
    expect(queue).toContain('decide(request.id, "NEEDS_INFO")')
    expect(queue).toContain('decide(request.id, "REJECTED")')
    expect(queue).not.toContain("undo")
  })
})
