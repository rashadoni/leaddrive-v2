// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatRecordedResolutionDuration, WorkforceExceptionRecordedOutcomesSummary } from "@/components/workforce/workforce-exception-recorded-outcomes"
import { buildWorkforceExceptionRecordedOutcomes, type RecordedExceptionReportCase } from "@/lib/workforce/exception-case-report-recorded-outcomes"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
function caseRecord(decisions: RecordedExceptionReportCase["decisions"]): RecordedExceptionReportCase {
  return { id: "private-case", organizationId: "private-org", agentId: "private-agent", workdayId: "private-workday", createdAt: new Date("2026-10-01T00:00:00Z"), decisions }
}

describe("recorded outcome presentation with real report builder and locale catalogs", () => {
  it.each(["en", "ru", "az"])("distinguishes empty samples and an observed zero in %s", async locale => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
    const copy = messages.workforceExceptionReport.recordedOutcomes
    const intlErrors = vi.fn()
    const render = async (cases: RecordedExceptionReportCase[]) => {
      const { recordedOutcomes } = buildWorkforceExceptionRecordedOutcomes({ organizationId: "private-org", cases, correctionProofs: [] })
      await act(async () => root.render(createElement(IntlProvider, { locale, messages, timeZone: "UTC", onError: intlErrors }, createElement(WorkforceExceptionRecordedOutcomesSummary, { outcomes: recordedOutcomes }))))
    }
    await render([])
    expect(container.querySelector('[data-testid="workforce-exception-recorded-link-share"]')?.textContent).toBe(copy.noCases)
    expect(container.querySelector('[data-testid="workforce-exception-recorded-resolution-mean"]')?.textContent).toBe(copy.noSamples)
    expect(container.textContent).toContain(copy.classificationUnavailable)

    await render([caseRecord([
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-10-01T00:00:00Z") },
      { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: new Date("2026-10-01T00:00:00Z") },
    ])])
    expect(container.querySelector('[data-testid="workforce-exception-recorded-link-share"]')?.textContent).toBe(new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(0))
    expect(container.querySelector('[data-testid="workforce-exception-recorded-resolution-mean"]')?.textContent).toBe(new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "long" }).format(0))
    expect(container.textContent).not.toContain(copy.noSamples)
    expect(container.textContent).not.toMatch(/private-case|private-agent|private-org|private-workday|workforceExceptionReport\./)
    expect(intlErrors).not.toHaveBeenCalled()
  })

  it("renders link, unresolved and integrity counts without classifying an outcome", async () => {
    const messages = JSON.parse(readFileSync("messages/en.json", "utf8"))
    const good = caseRecord([
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-10-01T00:00:00Z") },
      { caseRevision: 2, decisionCode: "RESOLVE_WITH_CORRECTION", createdAt: new Date("2026-10-01T01:00:00Z") },
    ])
    const unresolved = { ...caseRecord([]), id: "private-unresolved" }
    const bad = { ...caseRecord([{ caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: new Date("2026-10-01T02:00:00Z") }]), id: "private-invalid" }
    const { recordedOutcomes } = buildWorkforceExceptionRecordedOutcomes({
      organizationId: "private-org", cases: [good, unresolved, bad],
      correctionProofs: [{ organizationId: "private-org", agentId: "private-agent", workdayId: "private-workday", requestId: "private-request", source: "REQUEST_APPROVAL", request: { id: "private-request", organizationId: "private-org", agentId: "private-agent", type: "TIME_CORRECTION", status: "APPROVED", correctionWorkdayId: "private-workday", exceptionCaseId: "private-case" } }],
    })
    await act(async () => root.render(createElement(IntlProvider, { locale: "en", messages, timeZone: "UTC" }, createElement(WorkforceExceptionRecordedOutcomesSummary, { outcomes: recordedOutcomes }))))
    expect(container.querySelector('[data-testid="workforce-exception-recorded-link-share"]')?.textContent).toBe("33.33%")
    expect(container.querySelector('[data-testid="workforce-exception-recorded-resolution-mean"]')?.textContent).toBe("1 hour")
    for (const label of ["Valid resolved cases", "Unresolved cases", "Excluded for data integrity"]) {
      const term = Array.from(container.querySelectorAll("dt")).find(node => node.textContent === label)
      expect(term?.nextElementSibling?.textContent).toBe("1")
    }
    expect(container.textContent).toContain("1 of 3 recorded cases")
    expect(container.textContent).toContain(messages.workforceExceptionReport.recordedOutcomes.linkedHint)
    expect(container.textContent).toContain(messages.workforceExceptionReport.recordedOutcomes.classificationUnavailable)
    expect(container.innerHTML).not.toContain("private-")
  })
})

describe("elapsed duration formatting", () => {
  it.each([
    [0, "0 seconds"], [1, "0.001 seconds"], [59_999, "59.999 seconds"],
    [60_000, "1 minute"], [3_600_000, "1 hour"], [90_000_000, "1.042 days"],
  ])("formats %i milliseconds without wrapping at 24 hours", (milliseconds, expected) => {
    expect(formatRecordedResolutionDuration(milliseconds, "en")).toBe(expected)
  })
  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 0.5])("rejects unavailable or invalid elapsed values %s", value => {
    expect(formatRecordedResolutionDuration(value, "en")).toBeNull()
  })
})
