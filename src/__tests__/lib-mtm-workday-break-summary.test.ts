import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmWorkdayBreakSummary } from "@/lib/mtm/workday-break-summary"

/**
 * Field UX audit 2026-09-05, A7 tail: the segments themselves reach the web.
 * "On a break" answers what is happening now; a manager reading the card at
 * the end of the day is asking how the day went, and two twenty-minute breaks
 * are not the same day as one two-hour break.
 */
const NOW = new Date("2026-09-09T15:00:00.000Z")

describe("workday break summary", () => {
  it("counts the breaks and their total", () => {
    expect(mtmWorkdayBreakSummary([
      { from: "2026-09-09T09:00:00.000Z", to: "2026-09-09T09:20:00.000Z" },
      { from: "2026-09-09T12:00:00.000Z", to: "2026-09-09T12:25:00.000Z" },
    ], NOW)).toEqual({ count: 2, minutes: 45, ongoing: false })
  })

  it("counts an unfinished break up to now, and says it is unfinished", () => {
    // Otherwise someone standing on their break reads "1 break, 0 minutes".
    expect(mtmWorkdayBreakSummary([{ from: "2026-09-09T14:30:00.000Z", to: null }], NOW))
      .toEqual({ count: 1, minutes: 30, ongoing: true })
  })

  it("says nothing when there were none", () => {
    expect(mtmWorkdayBreakSummary([], NOW)).toEqual({ count: 0, minutes: 0, ongoing: false })
    expect(mtmWorkdayBreakSummary(null, NOW)).toEqual({ count: 0, minutes: 0, ongoing: false })
    expect(mtmWorkdayBreakSummary(undefined, NOW)).toEqual({ count: 0, minutes: 0, ongoing: false })
  })

  it("refuses a stretch that ends before it starts", () => {
    // A correction tool can write one; counting it would silently shorten the
    // day's total instead of showing an impossible number.
    expect(mtmWorkdayBreakSummary([
      { from: "2026-09-09T12:00:00.000Z", to: "2026-09-09T11:00:00.000Z" },
      { from: "2026-09-09T13:00:00.000Z", to: "2026-09-09T13:10:00.000Z" },
    ], NOW)).toEqual({ count: 1, minutes: 10, ongoing: false })
  })

  it("skips an unparseable moment rather than reporting NaN", () => {
    expect(mtmWorkdayBreakSummary([{ from: "not a date", to: null }], NOW))
      .toEqual({ count: 0, minutes: 0, ongoing: false })
  })

  it("keeps a sub-minute break visible in the count", () => {
    // It rounds to zero minutes, but it happened, and the count says so.
    expect(mtmWorkdayBreakSummary([{ from: "2026-09-09T10:00:00.000Z", to: "2026-09-09T10:00:30.000Z" }], NOW))
      .toEqual({ count: 1, minutes: 0, ongoing: false })
  })
})

describe("break segments wiring", () => {
  it("is served for the page's workdays in one query, not per agent", () => {
    const route = readFileSync("src/app/api/v1/mtm/agents/route.ts", "utf8")
    expect(route).toContain("workdayId: { in: days.map((day) => day.id) }")
    expect(route).toContain("serializeMtmWorkdayPauses(mtmWorkdayPauses(")
    expect(route.match(/prisma\.mtmAgentWorkdayEvent\.findMany/g) ?? []).toHaveLength(1)
  })

  it("reaches the card", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/agents/page.tsx", "utf8")
    expect(page).toContain("mtmWorkdayBreakSummary(agent?.breaks, new Date())")
    expect(page).toContain('data-testid="mtm-agent-breaks"')
  })

  it("has the summary line in every language", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const line = messages.mtmAgents?.breaksSummary
      if (typeof line !== "string" || !line.includes("{count}") || !line.includes("{minutes}")) {
        missing.push(locale)
      }
    }
    expect(missing).toEqual([])
  })
})
