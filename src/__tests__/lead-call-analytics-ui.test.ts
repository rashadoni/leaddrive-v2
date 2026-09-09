import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("src/components/leads/lead-call-analytics.tsx", "utf8")
const leadPage = readFileSync("src/app/(dashboard)/leads/[id]/page.tsx", "utf8")

describe("lead call analytics UI contract", () => {
  it("renders the analytics block in the default lead details flow", () => {
    expect(leadPage).toContain('import { LeadCallAnalytics }')
    expect(leadPage.indexOf("<LeadCallAnalytics")).toBeGreaterThan(leadPage.indexOf("<LeadStatBoxes"))
    expect(leadPage.indexOf("<LeadCallAnalytics")).toBeLessThan(leadPage.indexOf("<CustomerDetailsCards"))
  })

  it("loads only the lead-scoped endpoint and covers loading, retry and empty states", () => {
    expect(component).toContain("/call-insights")
    expect(component).toContain('aria-busy="true"')
    expect(component).toContain('aria-live="polite"')
    expect(component).toContain('t("leadLoadError")')
    expect(component).toContain('t("leadEmptyTitle")')
    expect(component).toContain('t("retry")')
  })

  it("exposes sentiment as text and supports keyboard expansion", () => {
    expect(component).toContain("sentimentLabels[call.insight.sentiment]")
    expect(component).toContain("aria-expanded={expanded}")
    expect(component).toContain("focus-visible:ring-2")
    expect(component).toContain("min-h-11")
  })

  it("ignores a late response after the lead changes or the component unmounts", () => {
    expect(component).toContain("requestVersionRef")
    expect(component).toContain("requestVersion !== requestVersionRef.current")
  })

  it("does not request or render sensitive call payload fields", () => {
    expect(component).not.toContain("fromNumber")
    expect(component).not.toContain("toNumber")
    expect(component).not.toContain("transcription")
    expect(component).not.toContain("providerCallId")
    expect(component).not.toContain("costUsd")
    expect(component).not.toContain("latencyMs")
  })
})
