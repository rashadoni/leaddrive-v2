import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mergeFirstPageRefresh, visitsRemainingInPeriod } from "@/lib/mtm/visit-history-pages"

/**
 * Audit 2026-09-24: «Визиты» with «Вся история» stopped at the latest 200
 * and put the period's total beside counts over the 200 shown.
 */
const visit = (id: string, minute: number) => ({ id, checkInAt: new Date(Date.UTC(2026, 8, 1, 8, minute)).toISOString() })
/** Newest first, as the API orders them. */
const page = (from: number, count: number) => Array.from({ length: count }, (_, index) => visit(`v${from + index}`, 10_000 - (from + index)))

describe("what the period still holds", () => {
  it("counts down an exact total page by page, to nothing", () => {
    const read = (pagesRead: number) => visitsRemainingInPeriod({ total: 450, totalExact: true, candidateLimit: null, pagesRead, lastPageFull: true })
    expect([read(1), read(2), read(3)]).toEqual([250, 50, 0])
  })

  it("without an exact total trusts only a full last page, and stops at the bounded read", () => {
    const bounded = { total: null, totalExact: false, candidateLimit: 2_000 }
    expect(visitsRemainingInPeriod({ ...bounded, pagesRead: 3, lastPageFull: true })).toBe(200)
    expect(visitsRemainingInPeriod({ ...bounded, pagesRead: 3, lastPageFull: false })).toBe(0)
    expect(visitsRemainingInPeriod({ ...bounded, pagesRead: 10, lastPageFull: true })).toBe(0)
  })
})

describe("the live refresh after «Показать ещё»", () => {
  it("keeps the second page below a fresh first page, without doubling the visit that slid across", () => {
    const shown = [...page(0, 200), ...page(200, 200)]
    // A new visit arrived: the first page now starts with it and v199 slid to page two.
    const fresh = [visit("new", 10_001), ...page(0, 199)]
    const merged = mergeFirstPageRefresh(shown, fresh)
    expect(merged).toHaveLength(401)
    expect(new Set(merged.map((row) => row.id)).size).toBe(401)
    expect(merged.slice(0, 2).map((row) => row.id)).toEqual(["new", "v0"])
    expect(merged.at(-1)?.id).toBe("v399")
  })

  it("drops a visit deleted from the first page's window, and keeps nothing when the period fits one page", () => {
    const shown = [...page(0, 200), ...page(200, 50)]
    const withoutV5 = [...page(0, 5), ...page(6, 195)]
    expect(mergeFirstPageRefresh(shown, withoutV5).map((row) => row.id)).not.toContain("v5")
    expect(mergeFirstPageRefresh(shown, page(0, 120))).toHaveLength(120)
  })
})

describe("the visits page", () => {
  const view = readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8")

  it("reaches every visit of the period, not only the latest 200", () => {
    expect(view).toContain("fetch(`/api/v1/mtm/visits?limit=${VISIT_PAGE_SIZE}&range=${historyRange}&page=${nextPage}`, { headers })")
    expect(view).toContain('data-testid="mtm-visits-load-more"')
    // A reload in between must not glue an old page onto the new list.
    expect(view).toContain("if (visitRequestRef.current.id !== requestId) return")
    expect(view).toContain("const rows = silent ? mergeFirstPageRefresh(current, listed) : listed")
  })

  it("does not put the period's total beside counts over the visits shown", () => {
    expect(view).toContain("{listIsPartial ? null : <>{t(\"statTotal\")}: {displayedTotal} · </>}")
  })

  it("says it in all three languages", () => {
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmVisitsPage
      expect(messages.loadMore).toContain("{count}")
      expect(messages.loadMoreFailed).toEqual(expect.any(String))
    }
  })
})
