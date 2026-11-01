import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
const { azCalendarWatchYears, readAzCalendarYear, fetchPublicPage } = await import("@/lib/mtm/az-calendar-watch")

const article = readFileSync("src/__tests__/fixtures/report-az-calendar-2026.html", "utf8")
const asYear = (year: number) => article.replaceAll("2026", String(year)).replaceAll("2025", String(year - 1))
const guessed = (year: number) => `https://report.az/sosial-mudafie/${year}-ci-il-ucun-is-vaxti-normasi-ve-istehsalat-teqvimi-tesdiq-edilib`

describe("the calendar watch", () => {
  it("looks for next year only from 15 November (Baku), and never for a decided or already read year", () => {
    expect(azCalendarWatchYears(new Date("2026-11-14T19:00:00Z"), [])).toEqual([])
    expect(azCalendarWatchYears(new Date("2026-11-14T20:00:00Z"), [])).toEqual([2027])
    expect(azCalendarWatchYears(new Date("2026-12-20T08:00:00Z"), [{ year: 2027, state: "PARSED" }])).toEqual([])
    expect(azCalendarWatchYears(new Date("2026-12-20T08:00:00Z"), [{ year: 2027, state: "UNREADABLE" }])).toEqual([2027])
    // In January a year still missing is looked for.
    expect(azCalendarWatchYears(new Date("2027-01-10T08:00:00Z"), [])).toEqual([2027])
  })

  it("reads the Ministry article at its usual address", async () => {
    const result = await readAzCalendarYear(2027, async (url) => url === guessed(2027) ? asYear(2027) : null, null)
    expect(result).toMatchObject({ state: "PARSED", url: guessed(2027) })
  })

  it("falls back to calendar-titled RSS items, and calls a readable-looking but broken article unreadable", async () => {
    const rss = `<rss><item><title>2027-ci il üçün istehsalat təqvimi təsdiq edilib</title><link>https://report.az/sosial-mudafie/other</link></item></rss>`
    const ok = await readAzCalendarYear(2027, async (url) => url.endsWith("/other") ? asYear(2027) : null, rss)
    expect(ok).toMatchObject({ state: "PARSED", url: "https://report.az/sosial-mudafie/other" })
    const broken = await readAzCalendarYear(2027, async (url) => url.endsWith("/other") ? asYear(2027).replace("<br>8 Noyabr – Zəfər Günü;", "") : null, rss)
    expect(broken).toMatchObject({ state: "UNREADABLE", url: "https://report.az/sosial-mudafie/other" })
    // An article about another year is not this year's news.
    expect(await readAzCalendarYear(2027, async (url) => url.endsWith("/other") ? article : null, rss)).toEqual({ state: "NONE" })
  })

  it("asks nothing but report.az", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    expect(await fetchPublicPage("https://evil.example/report.az/")).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
