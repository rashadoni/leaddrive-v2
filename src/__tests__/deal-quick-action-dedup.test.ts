import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const quickActionSource = readFileSync(
  "src/components/deals/quick-action-bar.tsx",
  "utf8",
)
const dealPageSource = readFileSync(
  "src/app/(dashboard)/deals/[id]/page.tsx",
  "utf8",
)

describe("deal quick actions", () => {
  it("keeps next-step creation in the dedicated widget only", () => {
    expect(quickActionSource).not.toContain("/next-steps")
    expect(quickActionSource).not.toContain('key: "task"')
    expect(dealPageSource).not.toContain("onTaskAdded=")
  })

  it("uses note-specific copy in the remaining quick action", () => {
    expect(quickActionSource).toContain("labels.notePlaceholder")
    expect(dealPageSource).toContain('notePlaceholder: tc("addDealNote")')
  })
})
