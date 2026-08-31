import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("src/components/workforce/workforce-my-exceptions.tsx", "utf8")

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforceMyExceptions as Record<string, unknown>
}

describe("Workforce employee exception response boundary", () => {
  it("renders the server-provided migration-required state instead of offering an unapplied acknowledgement write", () => {
    expect(component).toContain('body.data?.responseRecording !== "MIGRATION_REQUIRED"')
    expect(component).toContain('data-testid="workforce-my-exceptions-response-boundary"')
    expect(component).toContain('responseRecording === "MIGRATION_REQUIRED"')
    expect(component).toContain('t("responseRecordingUnavailableTitle")')
    expect(component).toContain('t("responseRecordingUnavailableHint")')
    expect(component).not.toContain('"/api/v1/workforce/exceptions/" +')
    expect(component).not.toContain('/response", "POST"')
  })

  it("keeps the employee response notice localized and clear about its non-mutating correction path", () => {
    for (const locale of ["en", "ru", "az"]) {
      const localized = messages(locale)
      for (const key of ["responseRecordingUnavailableTitle", "responseRecordingUnavailableHint"]) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
