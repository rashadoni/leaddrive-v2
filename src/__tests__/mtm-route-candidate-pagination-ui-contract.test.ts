import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function routeMessages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("MTM route candidate pagination UI contract", () => {
  const builder = source("src/components/mtm/route-builder.tsx")

  it("opts the canonical day planner into bounded cursor pages without changing selected stops", () => {
    expect(builder).toContain('pagination: "keyset"')
    expect(builder).toContain("limit: String(candidateResultPageSize)")
    expect(builder).toContain('params.set("cursor", candidatePageCursor)')
    expect(builder).toContain("setCandidateResults(result.data.candidates ?? [])")
    expect(builder).toContain("const candidateResultPageSize = 50")
    expect(builder).toContain("setCandidatePageCursors((current) => current.length === 1 && current[0] === null ? current : [null])")
  })

  it("keeps pagination accessible, retryable, and honest about unsupported global sorts", () => {
    expect(builder).toContain('data-testid="mtm-route-candidate-pagination"')
    expect(builder).toContain('aria-label={t("candidatePaginationLabel")}')
    expect(builder).toContain('aria-label={t("candidatePagePrevious")}')
    expect(builder).toContain('aria-label={t("candidatePageNext")}')
    expect(builder).toContain('aria-live="polite" aria-atomic="true"')
    expect(builder).toContain('role="alert"')
    expect(builder).toContain('setCandidatePageRetryVersion((current) => current + 1)')
    expect(builder).toContain('candidatePagination?.mode === "LEGACY_CAP"')
    expect(builder).toContain('t("candidateGlobalSortLimited")')
  })

  it("provides pagination and recovery copy in each supported language", () => {
    const keys = [
      "candidateGlobalSortLimited",
      "candidatePaginationLabel",
      "candidatePagePrevious",
      "candidatePageNext",
      "candidatePagePosition",
      "candidatePageLoading",
      "candidatePageExpired",
      "candidatePaginationRetry",
    ]
    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of keys) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
