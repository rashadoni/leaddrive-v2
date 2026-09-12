import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workbench = readFileSync("src/components/workforce/workforce-workbench.tsx", "utf8")

describe("Workforce employee self-request UI boundary", () => {
  it("keeps employee submission self-scoped and requests a manager decision before time changes", () => {
    expect(workbench).toContain("canSubmitSelf")
    expect(workbench).toContain("/api/v1/workforce/requests/")
    expect(workbench).toContain("/cancel")
    expect(workbench).toContain("selfRequestHint")
    expect(workbench).toContain("selfRequestPendingHint")
  })

  it("uses a named self workday picker and timezone-labelled local correction boundaries", () => {
    expect(workbench).toContain("selfWorkdays.map")
    expect(workbench).toContain("selfRequestWorkday")
    expect(workbench).toContain("datetime-local")
    expect(workbench).toContain("selfRequestStartTime")
    expect(workbench).toContain("selfRequestEndTime")
  })
})
