import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Audit 2026-09-21: «Визиты» opened on «Сегодня» with a full set of controls
 * around zero while a week of visits existed; «Фотографии» opened on «Эта
 * неделя» with four zeros while 1367 photos were stored. The rule lives in
 * `src/lib/mtm/empty-period-fallback.ts` (tested on its own); these pins keep
 * both screens wired to it and keep the reader's own choice sacred.
 */
const visits = readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8")
const photos = readFileSync("src/app/(dashboard)/mtm/photos/page.tsx", "utf8")
const messages = Object.fromEntries(["en", "ru", "az"].map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8"))]))

describe("screens that no longer open on an empty period", () => {
  it.each([
    ["visits", visits, "HISTORY_RANGE_ORDER", "historyRange", "mtm-visits-widened"],
    ["photos", photos, "PHOTO_PERIOD_ORDER", "period", "mtm-photos-widened"],
  ])("%s widens through the shared rule and says so", (_name, page, order, current, testId) => {
    expect(page).toContain('import { nextWiderPeriod } from "@/lib/mtm/empty-period-fallback"')
    expect(page).toContain(`order: ${order},`)
    expect(page).toContain(`current: ${current},`)
    expect(page).toContain("alreadyWidened: widenedFrom !== null,")
    expect(page).toContain(`data-testid="${testId}"`)
    expect(page).toContain('t("widenedNotice"')
  })

  /** A filter that moves under the reader's hand is worse than an empty one. */
  it("stops widening the moment the reader picks a period", () => {
    expect(visits).toContain("setRangeChosenByUser(true)")
    expect(visits).toContain("userChose: rangeChosenByUser,")
    expect(photos).toContain("setPeriodChosenByUser(true)")
    expect(photos).toContain("userChose: periodChosenByUser,")
  })

  /** The agent and status filters are the reader's choices; only the period is ours. */
  it("measures photo emptiness on the period alone", () => {
    // The server's count of the period across statuses (audit 2026-09-26).
    expect(photos).toContain("rows: periodTotal,")
    expect(photos).not.toContain("rows: filtered.length,")
  })

  it("has the notice in every language", () => {
    for (const locale of ["en", "ru", "az"]) {
      expect(messages[locale].mtmVisitsPage.widenedNotice).toMatch(/\{from\}.*\{to\}/)
      expect(messages[locale].mtmPhotosPage.widenedNotice).toMatch(/\{from\}.*\{to\}/)
    }
  })
})
