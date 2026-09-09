import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("MTM contact workplace UI contract", () => {
  it("connects current workplace actions to direct manager and reviewed agent flows", () => {
    const detail = readFileSync("src/components/mtm/contact-detail.tsx", "utf8")
    const dialog = readFileSync("src/components/mtm/contact-workplace-dialog.tsx", "utf8")

    expect(detail).toContain("MtmContactWorkplaceDialog")
    expect(detail).toContain("MtmContactWorkplaceEndDialog")
    expect(detail).toContain("capabilities.canManage || capabilities.canRequestChanges")
    expect(detail).toContain("min-h-11")

    expect(dialog).toContain("/api/v1/mtm/organizations?")
    expect(dialog).toContain("/workplaces`")
    expect(dialog).toContain("/change-requests`")
    expect(dialog).toContain('kind: "WORKPLACE_UPSERT"')
    expect(dialog).toContain('kind: "WORKPLACE_END"')
    expect(dialog).toContain("expectedContactUpdatedAt")
    expect(dialog).toContain("expectedUpdatedAt")
    expect(dialog).toContain("idempotencyKey")
  })
})
