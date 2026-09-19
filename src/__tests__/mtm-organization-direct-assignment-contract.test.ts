import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const detail = readFileSync("src/components/mtm/organization-detail.tsx", "utf8")
const explorer = readFileSync("src/components/mtm/organization-explorer.tsx", "utf8")

describe("organization detail assignment handoff", () => {
  it("offers assign and unassign actions from the staff tab", () => {
    expect(detail).toContain("assignmentTarget=${encodeURIComponent(organizationId)}&assignmentMode=ASSIGN")
    expect(detail).toContain("assignmentTarget=${encodeURIComponent(organizationId)}&assignmentMode=UNASSIGN")
    expect(detail).toContain("{canManage ? (")
  })

  it("opens the existing preview-first assignment dialog for only that organization", () => {
    expect(explorer).toContain('params.get("assignmentTarget")')
    expect(explorer).toContain('params.get("assignmentMode") === "UNASSIGN"')
    expect(explorer).toContain("setSelected(new Set([direct.organizationId]))")
    expect(explorer).toContain("setAssignmentOpen(true)")
    expect(explorer).toContain("setPreview(null)")
  })
})
