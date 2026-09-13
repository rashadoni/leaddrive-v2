import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("src/components/workforce/workforce-my-exceptions.tsx", "utf8")

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforceMyExceptions as Record<string, unknown>
}

describe("Workforce employee exception response boundary", () => {
  it("keeps the acknowledgement write hidden until the server confirms its per-tenant rollout", () => {
    expect(component).toContain('body.data?.responseRecording !== "MIGRATION_REQUIRED"')
    expect(component).toContain('body.data?.responseRecording !== "AVAILABLE"')
    expect(component).toContain('data-testid="workforce-my-exceptions-response-boundary"')
    expect(component).toContain('responseRecording === "MIGRATION_REQUIRED"')
    expect(component).toContain('t("responseRecordingUnavailableTitle")')
    expect(component).toContain('t("responseRecordingUnavailableHint")')
    expect(component).toContain('isWorkdayCorrection && responseRecording === "AVAILABLE" && item.responseState === "NOT_ACKNOWLEDGED"')
    expect(component).toContain('`/api/v1/workforce/exceptions/${encodeURIComponent(item.caseId)}/response`')
    expect(component).toContain('responseCode: "ACKNOWLEDGED"')
    expect(component).toContain('globalThis.crypto.randomUUID()')
    expect(component).toContain('isWorkdayCorrection && responseRecording === "AVAILABLE" && item.responseState === "ACKNOWLEDGED"')
  })

  it("keeps a schedule-only no-show visible but strictly outside workday correction and acknowledgement writes", () => {
    expect(component).toContain('item.availableAction === "VIEW_ONLY_NO_SHOW"')
    expect(component).toContain('t("expectedWorkday"')
    expect(component).toContain('data-testid="workforce-no-show-self-review-boundary"')
    expect(component).toContain('item.availableAction === "REQUEST_CORRECTION" ? item.workdayId : null')
    expect(component).toContain('isWorkdayCorrection && responseRecording === "AVAILABLE"')
  })

  it("keeps the employee response notice localized and clear about its non-mutating correction path", () => {
    for (const locale of ["en", "ru", "az"]) {
      const localized = messages(locale)
      for (const key of [
        "responseRecordingUnavailableTitle",
        "responseRecordingUnavailableHint",
        "acknowledgeForReview",
        "acknowledgeForReviewHint",
        "acknowledgedForReview",
        "acknowledgeFailed",
        "expectedWorkday",
        "noShowReviewOnlyHint",
      ]) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
