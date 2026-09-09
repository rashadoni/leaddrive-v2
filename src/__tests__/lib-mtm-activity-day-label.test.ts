import { describe, expect, it } from "vitest"
import { dayLabel } from "@/lib/mtm/activity-actions"

/**
 * Field UX audit W-02 / task C2. The activity journal groups rows under a day
 * header, and that header was the last direct `toLocaleDateString` left on the
 * MTM reading path. On an ICU build without Azerbaijani data — Chrome and the
 * production Node both qualify — it rendered "2026 M05 14" above every group.
 */
const t = (key: string) => key

describe("MTM activity journal day headers", () => {
  const iso = "2026-05-14T09:30:00.000Z"

  it("writes the month in Azerbaijani", () => {
    const label = dayLabel(iso, t, "az")
    expect(label).toContain("may")
    expect(label).toContain("2026")
    expect(label).not.toMatch(/M0?5/)
  })

  it("keeps the other locales on their own month names", () => {
    expect(dayLabel(iso, t, "ru")).toContain("мая")
    expect(dayLabel(iso, t, "en")).toContain("May")
  })

  it("still prefers the words for today and yesterday", () => {
    const now = new Date()
    // Built the way the function builds it, so a 23- or 25-hour day cannot
    // make this test disagree with the code it is pinning.
    const yesterday = new Date()
    yesterday.setDate(now.getDate() - 1)
    expect(dayLabel(now.toISOString(), t, "az")).toBe("dayToday")
    expect(dayLabel(yesterday.toISOString(), t, "az")).toBe("dayYesterday")
  })
})
