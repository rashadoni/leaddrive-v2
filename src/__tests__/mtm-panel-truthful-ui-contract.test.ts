import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Prod audit 2026-09-14 (agent Anar Mammadov): the Panel showed an office
 * manager a blank picker, a raw route id, stops numbered from 0, task cuids,
 * an agent-facing "close your shift" box and no alerts. These pins keep the
 * manager-facing shapes in place.
 */
const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")
const page = readFileSync("src/app/(dashboard)/mtm/page.tsx", "utf8")
const home = readFileSync("src/components/mtm/home-dashboard.tsx", "utf8")
const homeTeamCard = readFileSync("src/components/mtm/home-team-card.tsx", "utf8")
const homeAttentionCard = readFileSync("src/components/mtm/home-attention-card.tsx", "utf8")
const homeParts = readFileSync("src/components/mtm/home-parts.tsx", "utf8")
const homeData = readFileSync("src/components/mtm/home-data.ts", "utf8")
const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))

describe("MTM Panel for a manager", () => {
  // 2026-09-14 the Panel opened blank until an employee was picked; 2026-09-21
  // its 17×6 table became one line of facts; 2026-10-11 the owner looked at
  // that line on a Sunday evening («разве это должно быть на главном?»),
  // rejected the same content drawn as rows of grey text, and accepted a
  // picture: four figures, «ждёт решения», the team with a strip of the week.
  it("opens on the home screen instead of a blank picker, and a name or a day opens the week", () => {
    expect(ui).toContain("/api/v1/mtm/week/team?")
    expect(ui).toContain("<MtmHomeDashboard")
    // The team view is the home screen; it is not drawn only when the
    // bootstrap named a refusal the team request repeats (403, 404). A timeout
    // or a 429 on the filters does not hide a list /week/team already returned.
    expect(ui).toContain('const bootstrapFailed = phase === "permission" || phase === "notFound"\n')
    expect(ui).not.toContain('const bootstrapFailed = phase === "permission" || phase === "notFound" || phase === "rateLimited"')
    expect(ui).toContain("const homeLayout = teamLayout && !bootstrapFailed")
    // While `query` is still null (SSR and the first client frame) the layout
    // comes from the URL, so a deep link `/mtm?weekAgentId=…` does not flash
    // the home screen it never requests.
    expect(ui).toContain('const urlAgentId = searchParams.get("weekAgentId") || ""')
    expect(ui).toContain("const teamLayout = query ? teamViewActive : !urlAgentId")
    expect(ui).toContain('(phase === "loading" || phase === "idle") && !teamLayout ?')
    // Numbers are shown only for the filters on screen: the payload carries
    // its scope, and a list of another scope is not read under new filters.
    expect(ui).toContain("const currentTeamToday = teamTodayForScope(teamToday, teamScopeKey)")
    expect(ui).toContain("team={currentTeamToday}")
    expect(ui).toContain("normalizeTeamToday(body, scopeKey)")
    // A name opens that employee's week on today, a day cell on that day.
    expect(ui).toContain("const date = day || currentTeamToday?.today || query.date")
    expect(ui).toContain("updateQuery({ ...query, agentId, day: date, date })")
    expect(homeTeamCard).toContain("onClick={() => onOpenAgent(row.agentId)}")
    expect(homeTeamCard).toContain("onClick={() => onOpenAgent(row.agentId, cell.date)}")
    // One heading per layout: the date on the home screen, the week's own title otherwise.
    expect(ui).toContain('aria-labelledby={homeLayout ? "mtm-home-title" : "operational-week-title"}')
    expect(home).toContain('<h2 id="mtm-home-title"')
    expect(ui.match(/id="operational-week-title"/g)).toHaveLength(2)
    // The greeting and the clock stand above one employee's week only.
    expect(ui).toContain("{homeLayout ? null : agentHeader}")
    expect(page).toContain("agentHeader={(")
    expect(page.indexOf("<DashboardClock")).toBeGreaterThan(page.indexOf("agentHeader={("))
  })

  it("draws the home screen as cards in the page: figures, «ждёт решения», the team's week", () => {
    // Every number comes from the pure module, not from JSX.
    for (const call of ["homeTeam(team.rows, team.workdayEnabled)", "fieldNow(entries)", "todayPlan(entries)", "planCard({", "weekTotals(", "finishedDaysPercent(", "weekComparison("]) {
      expect(home, call).toContain(call)
    }
    // Four figures, then the two cards; what waits stands before the team.
    const order = ["mtm-home-kpi-field", "mtm-home-kpi-plan", "mtm-home-kpi-week", "mtm-home-kpi-attention", "<HomeAttentionCard", "<HomeTeamCard"].map((mark) => home.indexOf(mark))
    expect(order.every((position) => position > 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // The week is read from the endpoint «Результаты» reads, never counted a second way.
    expect(homeData).toContain("fetch(`/api/v1/mtm/kpi?${params.toString()}`")
    expect(homeData).toContain("drilldown.planDenominator")
    expect(homeData).not.toContain("prisma")
    expect(homeTeamCard).toContain('href="/mtm/analytics?period=thisWeek"')
    // No inner scroll frame, no table, no disclosure widget: a long team grows in the page.
    for (const [name, source] of [["home-dashboard", home], ["home-team-card", homeTeamCard], ["home-attention-card", homeAttentionCard], ["home-parts", homeParts]] as const) {
      expect(source, name).not.toMatch(/overflow-y-auto|overflow-x-auto|overflow-auto|max-h-|sticky|<table\b|<details\b|<aside\b/)
    }
    expect(homeTeamCard).toContain("HOME_TEAM_ROWS_SHOWN = 8")
    // Every row of «ждёт решения» ends in a button with words that opens its own list.
    expect(homeAttentionCard).toContain("href: attentionItemHref(item)")
    expect(homeAttentionCard).toContain("<Link href={row.href} prefetch={false}>{row.cta}</Link>")
    // A check that failed is not «nothing waits».
    expect(homeAttentionCard).toContain('data-testid="mtm-home-attention-error"')
    // Shifts are Workforce, withdrawn from the CRM on 2026-10-10: not a row here.
    expect(readFileSync("src/app/api/v1/mtm/week/attention/route.ts", "utf8")).not.toContain("mtmAgentWorkday")
    // A filter with nothing to choose from is not drawn.
    expect(ui).toContain("const regionField = filters.regions.length > 0 || query?.regionId ? (")
    expect(ui).toContain("const teamField = filters.teams.length > 0 || query?.teamId ? (")
  })

  /**
   * The audit of 2026-09-21 asked for LESS navigation on this screen, not
   * more. A second «choose another employee» control in the week header sat
   * directly above the employee select that does the same thing — exactly
   * the duplicate navigation the redesign removed elsewhere. One is enough,
   * and it belongs to the «employee unavailable» state where no select is
   * reachable.
   */
  it("offers «choose another employee» exactly once", () => {
    const occurrences = ui.split('t("chooseAnotherEmployee")').length - 1
    expect(occurrences).toBe(1)
    const weekHeader = ui.slice(ui.indexOf('<h2 id="operational-week-title" className="mt-1'), ui.indexOf("</div>", ui.indexOf('<h2 id="operational-week-title" className="mt-1')))
    expect(weekHeader).not.toContain('t("chooseAnotherEmployee")')
  })

  it("shows today's alerts in the attention rail and on the day card, linking to the alerts page", () => {
    expect(ui).toContain("data-testid={`mtm-week-alerts-${railId}`}")
    expect(ui).toContain('data-testid="mtm-week-day-alerts"')
    expect(ui).toContain("`/mtm/alerts?agentId=${encodeURIComponent(effectiveAgentId)}`")
    expect(ui).toContain("alertT(`messages.${group.messageKey}` as never")
  })

  it("uses one manager workday state and keeps the close/continue instruction for the agent", () => {
    expect(ui).toContain('data-testid="mtm-week-workday-left-open"')
    expect(ui).toContain("facts.workdayCapability.canMutateSelf && facts.workdayCapability.requiresPriorDayClosure")
    expect(ui).toContain("if (managerView && day.isToday && facts?.managerWorkday)")
  })

  it("names routes by date, numbers stops from 1, hides task ids for managers and says an empty day in one line", () => {
    expect(ui).not.toContain('firstString(source, "name", "title") || id')
    expect(ui).toContain('t("routeFallbackName"')
    expect(ui).toContain("renderPoint(point, day, index + 1)")
    expect(ui).not.toContain("{point.order}")
    expect(ui).toMatch(/\{!managerView \? \(\s*<p className="mt-1 text-\[11px\] text-muted-foreground" title=\{task\.id\}/)
    // Owner 2026-09-22: an empty day is one line («Маршрута нет»), not an icon,
    // a title and a sentence per past/future date.
    expect(ui).toContain('t("noRouteThisDay")')
    expect(ui).not.toContain('`${emptyPlanKey}Hint`')
  })

  it("puts visit evidence on point cards as counts, never note text", () => {
    const evidence = ui.slice(ui.indexOf('data-testid="mtm-week-visit-evidence"'), ui.indexOf("</p>", ui.indexOf('data-testid="mtm-week-visit-evidence"')))
    for (const key of ["visitEvidence.inOut", "visitEvidence.minutes", "visitEvidence.photos", "visitEvidence.signature", "visitEvidence.note"]) {
      expect(evidence).toContain(key)
    }
    expect(evidence).not.toContain("cancellationReason")
    expect(ui).toContain("`/mtm/visits?visitId=${encodeURIComponent(point.visitId)}`")
  })

  // Audit 2026-09-21: the instruction paragraph («Нажмите на строку…») and the
  // three buttons that duplicated the tabs are gone, so the old check on the
  // wording of nextStepHint became a check that the key no longer exists.
  it("shows the supervisor facts first, without instructions or duplicate navigation", () => {
    expect(page).not.toContain("<details")
    expect(page).not.toContain('td("nextStepHint")')
    expect(page).not.toMatch(/href="\/mtm\/(routes|visits|map)"/)
    // The team summary precedes the announcement block.
    expect(page.indexOf("<OperationalWeekHome")).toBeLessThan(page.indexOf('td("announcementLoading")'))
    for (const locale of ["az", "ru", "en"]) {
      expect(messages[locale].mtmDashboardPage).not.toHaveProperty("nextStepHint")
      expect(messages[locale].mtmDashboardPage).not.toHaveProperty("openPlan")
      expect(messages[locale].mtmDashboardPage.operationalWeek).not.toHaveProperty("teamTodayHint")
      expect(messages[locale].mtmDashboardPage.operationalWeek).not.toHaveProperty("description")
    }
    expect(messages.az.mtmDashboardPage.operationalWeek.workdayLeftOpen).toBe("Növbə {date} {time}-dən açıqdır ({duration}) — agent bağlamayıb")
  })

  it("keeps every count of the home screen an ICU argument with the plural forms of each locale", () => {
    const plural = [
      "kpiInFieldUnit", "kpiPointsUnit", "todayVisits", "weekRemaining", "issuesUnit",
      "rowContactCreateRequests", "rowCustomerCreateRequests", "rowRouteChangeRequests", "rowRoutesAwaitingPublish",
      "rowOlderAlerts", "rowPhotosPendingReview", "footVisits", "showMore",
    ]
    for (const key of plural) {
      const ru: string = messages.ru.mtmDashboardPage.home[key]
      for (const form of ["one {", "few {", "many {", "other {"]) expect(ru, `ru ${key} ${form}`).toContain(form)
      for (const locale of ["az", "en"]) {
        const text: string = messages[locale].mtmDashboardPage.home[key]
        expect(text, `${locale} ${key}`).toContain("one {")
        expect(text, `${locale} ${key}`).toContain("other {")
      }
    }
    for (const locale of ["az", "ru", "en"]) {
      const words = messages[locale].mtmDashboardPage.home
      for (const key of ["lastVisit", "subWaitingSince", "subNearest", "subOldest", "rowNoRouteDate", "kpiNextDayPlan", "cellPlan", "cellUpcoming", "cellVisited", "cellNone", "cellOff"]) {
        expect(words[key], `${locale} ${key}`).toContain("{date}")
      }
      for (const key of ["weekDeltaUp", "weekDeltaDown"]) {
        expect(words[key], `${locale} ${key}`).toContain("{percent}")
        expect(words[key], `${locale} ${key}`).toContain("{delta}")
      }
      expect(words.cellPlan).toContain("{done}")
      expect(words.cellPlan).toContain("{planned}")
      expect(words.subWithoutRouteCount).toContain("{count}")
      expect(words.subWithoutRouteCount).toContain("{total}")
      // Every row ends in a button with words on it, never an icon alone.
      for (const key of ["ctaRequest", "ctaResolve", "ctaPublish", "ctaReviewPhotos", "ctaPlan", "retry", "openMap", "openResults"]) {
        expect(words[key].length, `${locale} ${key}`).toBeGreaterThan(2)
      }
    }
    // The text-row version of 2026-10-11 the owner rejected left no wording behind.
    for (const locale of ["az", "ru", "en"]) {
      expect(messages[locale].mtmDashboardPage.operationalWeek).not.toHaveProperty("attention")
      expect(messages[locale].mtmDashboardPage.operationalWeek).not.toHaveProperty("week")
    }
  })

  it("keeps every number in the summary an ICU argument with the plural forms of each locale", () => {
    const plural = ["summaryOpenShifts", "summaryWithoutPlan", "teamIdleCollapsed", "teamIdleNoActivity", "teamRowOpenAlerts", "teamRowVisits"]
    for (const key of plural) {
      const ru: string = messages.ru.mtmDashboardPage.operationalWeek[key]
      for (const form of ["one {", "few {", "many {", "other {"]) expect(ru, `ru ${key} ${form}`).toContain(form)
      for (const locale of ["az", "en"]) {
        const text: string = messages[locale].mtmDashboardPage.operationalWeek[key]
        expect(text, `${locale} ${key}`).toContain("one {")
        expect(text, `${locale} ${key}`).toContain("other {")
      }
    }
    for (const locale of ["az", "ru", "en"]) {
      for (const key of ["summaryInField", "summaryOnVisit"]) {
        const text: string = messages[locale].mtmDashboardPage.operationalWeek[key]
        expect(text).toContain("{count}")
        expect(text).toContain("{total}")
      }
      expect(messages[locale].mtmDashboardPage.operationalWeek.teamRouteProgress).toContain("{visited}/{total}")
    }
  })
})
