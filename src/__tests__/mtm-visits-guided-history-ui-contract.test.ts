import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function visitMessages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmVisitsPage as Record<string, unknown>
}

describe("MTM visits guided history UI contract", () => {
  const page = source("src/app/(dashboard)/mtm/visits/page.tsx")
  const api = source("src/app/api/v1/mtm/visits/route.ts")

  it("starts with today's visits and offers explicit, tenant-timezone history periods", () => {
    expect(page).toContain('useState<HistoryRange>("today")')
    expect(page).toContain('"today" | "7d" | "30d" | "all"')
    expect(page).toContain('range=${historyRange}')
    expect(api).toContain('requestedRange === "today"')
    expect(api).toContain('currentDateKey(new Date(), timezone)')
    expect(api).toContain('localDateKeyToUtc(firstDay, timezone)')
    expect(api).toContain('localDateKeyToUtc(addDateKeyDays(today, 1), timezone)')
    expect(api).toContain("timezone,")
  })

  it("shows active work before history and replaces raw enums with plain-language states", () => {
    expect(page.indexOf('id="active-visit-title"')).toBeLessThan(page.indexOf('id="visit-history-title"'))
    expect(page).toContain("visitStatusKey(visit.status)")
    expect(page).toContain('status === "CHECKED_IN"')
    expect(page).toContain('status === "CHECKED_OUT"')
    expect(page).not.toContain("{v.status}")
    expect(page).toContain('confirmed ? "gpsConfirmed" : "gpsOutside"')
    expect(page).toContain('t("gpsUnavailable")')
  })

  it("uses localized tenant-timezone dates and explains bounded results", () => {
    expect(page).toContain("formatDateTime(value, locale")
    expect(page).toContain("timeZone: meta.timezone")
    expect(page).not.toContain("toLocaleString()")
    expect(page).toContain('t("resultBounded"')
    expect(page).toContain('t("resultPartial"')
    expect(api).toContain("sourceTruncated,")
    expect(api).toContain("candidateLimit:")
  })

  it("uses a desktop summary table and touch-safe cards on phones and tablets", () => {
    expect(page).toContain('className="hidden overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 xl:block"')
    expect(page).toContain('data-testid="mtm-visit-mobile-cards"')
    expect(page).toContain("xl:hidden")
    expect(page).toContain("min-h-11 min-w-11")
    expect(page).toContain("DropdownMenu")
    expect(page).toContain("requestDelete(visit)")
  })

  it("localizes every new history concept in Azerbaijani, Russian, and English", () => {
    const keys = [
      "activeVisitTitle",
      "activeVisitHint",
      "historyTitle",
      "historyHint",
      "rangeLabel",
      "rangeToday",
      "range7Days",
      "range30Days",
      "rangeAll",
      "statusFilterLabel",
      "statGpsConfirmed",
      "statusInProgress",
      "statusCompleted",
      "statusCancelled",
      "statusUnknown",
      "gpsConfirmed",
      "gpsOutside",
      "gpsUnavailable",
      "resultCount",
      "resultPartial",
      "resultBounded",
      "emptyForRange",
      "emptyForRangeHint",
      "noResultsHint",
      "moreActions",
    ]

    for (const locale of ["az", "ru", "en"]) {
      const messages = visitMessages(locale)
      for (const key of keys) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
