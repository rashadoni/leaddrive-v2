import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("MTM contact duplicate approval UI contract", () => {
  it("connects Agent reporting and Manager review without direct merging", () => {
    const detail = readFileSync("src/components/mtm/contact-detail.tsx", "utf8")
    const dialog = readFileSync("src/components/mtm/contact-duplicate-dialog.tsx", "utf8")
    const submitRoute = readFileSync("src/app/api/v1/mtm/contacts/[id]/change-requests/route.ts", "utf8")
    const decisionRoute = readFileSync("src/app/api/v1/mtm/contact-change-requests/[id]/decision/route.ts", "utf8")

    expect(detail).toContain("MtmContactDuplicateReportDialog")
    expect(detail).toContain("MtmContactDuplicateDecisionDialog")
    expect(detail).toContain("activeDuplicateRequest")
    expect(detail).toContain("min-h-11")

    expect(dialog).toContain("/api/v1/mtm/contacts?")
    expect(dialog).toContain("/change-requests`")
    expect(dialog).toContain('kind: "DUPLICATE_REPORT"')
    expect(dialog).toContain("expectedContactUpdatedAt")
    expect(dialog).toContain("idempotencyKey")
    expect(dialog).toContain("/decision`")
    expect(dialog).not.toContain("method: \"PUT\"")

    expect(submitRoute).toContain('status: { notIn: ["DUPLICATE", "MERGED"] }')
    expect(decisionRoute).toContain('status: { notIn: ["DUPLICATE", "MERGED"] }')
    expect(decisionRoute).toContain('data: { status: "DUPLICATE", duplicateOfContactId: target.id }')
  })
})
