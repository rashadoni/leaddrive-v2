import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("SWM-05 governed contact coverage UI contract", () => {
  it("keeps period, provenance, fail-closed states, desktop and phone rendering wired together", () => {
    const api = readFileSync("src/app/api/v1/mtm/contacts/route.ts", "utf8")
    const ui = readFileSync("src/components/mtm/contact-explorer.tsx", "utf8")
    const filters = readFileSync("src/lib/mtm/contact-explorer.ts", "utf8")

    expect(api).toContain("readGovernedCoverageMany")
    expect(api).toContain("mtmCoverageSnapshotRow.findMany")
    expect(api).toContain('state: "NOT_IN_SNAPSHOT"')
    expect(api).toContain("approvalReference")
    expect(filters).toContain("coveragePeriod")
    expect(ui).toContain('type="month"')
    expect(ui).toContain("<ContactCoverageCell coverage={contact.coverage} t={t} />")
    expect(ui).toContain('t("coverageValues"')
    expect(ui).toContain('t("coverageProof"')
  })
})
