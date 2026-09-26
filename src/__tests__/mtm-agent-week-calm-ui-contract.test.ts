import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Owner 2026-09-22, on the agent's week opened from the Panel: «eyes run in
 * all directions, the poor manager cannot make sense of it». One fact told
 * four times, zeros with sentences explaining the zero, developer words.
 */
const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")
const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [
  locale,
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmDashboardPage.operationalWeek,
]))

describe("the agent's week, for a manager", () => {
  it("says when the agent was last heard from in one line, not four cells", () => {
    expect(ui).toContain('data-testid="mtm-week-status-line"')
    expect(ui).not.toContain('t("gpsFreshness")')
    expect(ui).not.toContain('t("lastCoordinate")')
    expect(ui).not.toContain('t("locationEvidence")')
    expect(ui).not.toContain('<p className="text-xs text-muted-foreground">{t("workdayState")}</p>')
    // The left-open banner already says it; the line does not repeat it.
    expect(ui).toContain("const workday = facts.workdayCapability.enabled && !leftOpenShown ? dayWorkdayPresentation(selectedDay) : null")
    expect(ui).not.toContain('t("workdayLeftOpenHint")')
  })

  it("replaces an empty plan and empty attention sections with one sentence each", () => {
    expect(ui).toContain('t("noPlanInPeriod")')
    expect(ui).toContain('t("nothingNeedsAttention")')
    expect(ui).not.toContain('t("noOpenAlerts")')
    expect(ui).not.toContain('t("noPendingCancellations")')
    expect(ui).not.toContain('t("noActiveTasks")')
    expect(ui).toContain("if (!groups.length) return null")
  })

  it("keeps developer words off the screen", () => {
    expect(ui).not.toContain('t("scopeConfirmed")')
    expect(ui).not.toContain('t("baseCoverageEyebrow")')
    expect(ui).not.toContain('t("sourceUpdatedAt"')
    expect(ui).not.toContain('t("publishedPlan")')
    // Base coverage appears only with its numbers.
    expect(ui).toContain("baseCoveragePhase === \"ready\" && baseCoverage?.available && baseCoverage.totals && !cachedSnapshot ? (")
  })

  it("words the new lines in all three languages", () => {
    for (const locale of ["az", "ru", "en"]) {
      for (const key of ["gpsSeenAt", "gpsSilentSince"]) expect(messages[locale][key]).toContain("{time}")
      for (const key of ["openGpsPath", "noPlanInPeriod", "nothingNeedsAttention"]) expect(typeof messages[locale][key]).toBe("string")
    }
  })

  it("keeps a day card to what happened: no zero counters, no triple empty state, the shift named once", () => {
    expect(ui).toContain("const dayHasCounts = day.summary.planned + day.summary.actual + day.summary.cancelled > 0")
    expect(ui).toContain('data-testid="mtm-week-day-no-route"')
    expect(ui).toContain('t("workdayLeftOpenShort")')
    expect(ui).toContain('{pointCount ? <span className="text-xs text-muted-foreground">{t(planRowsMayBeTruncated')
    for (const locale of ["az", "ru", "en"]) {
      expect(typeof messages[locale].noRouteThisDay).toBe("string")
      expect(messages[locale].stopsCount).not.toMatch(/точ|nöqt|stop/i)
    }
  })
})

/**
 * Owner 2026-09-23: «I open the Panel, it opens, and a second later the panel
 * is gone» — reading fourteen agents takes seconds and the screen fell back to
 * «loading» on every visit.
 */
describe("the Panel keeps the last team list", () => {
  it("shows the remembered list at once and marks it as refreshing", () => {
    expect(ui).toContain("const cached = readTeamToday(scopeKey)")
    expect(ui).toContain("rememberTeamToday(normalized)")
    expect(ui).toContain('window.sessionStorage.setItem(`${TEAM_TODAY_CACHE_KEY}:${payload.scopeKey}`')
    // Never the numbers of another region or team.
    expect(ui).toContain("parsed.scopeKey === scopeKey && Array.isArray(parsed.rows)")
    expect(ui).toContain('teamFromCache && teamPhase === "loading" ? <span className="text-muted-foreground">{t("teamRefreshing")}</span>')
    for (const locale of ["az", "ru", "en"]) expect(typeof messages[locale].teamRefreshing).toBe("string")
  })
})
