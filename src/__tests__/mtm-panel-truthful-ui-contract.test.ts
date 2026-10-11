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
const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))

describe("MTM Panel for a manager", () => {
  // Audit 2026-09-21: the 17×6 table became one line of facts plus only the
  // rows that carry a fact, so the old slice "testid → first </table>" would
  // now run to the end of the file. The slice ends at the section instead.
  it("opens on the team summary line instead of a blank picker, and a row opens the week", () => {
    expect(ui).toContain("/api/v1/mtm/week/team?")
    expect(ui).toContain('data-testid="mtm-week-team-today"')
    expect(ui).toContain('data-testid="mtm-week-team-summary"')
    expect(ui).toContain("updateQuery({ ...query, agentId: row.agentId")
    // Stage A of "close the shift": the honest action is the agent's week.
    expect(ui).toContain("const openLeftOpenShift = openWeek")
    expect(ui).toContain('data-testid="mtm-week-team-idle-toggle"')
    const start = ui.indexOf('data-testid="mtm-week-team-today"')
    const team = ui.slice(start, ui.indexOf("</section>", start))
    // Every number in the summary comes from the pure module, not from JSX.
    const render = ui.slice(ui.indexOf("function renderTeamToday()"), ui.indexOf("\n  }\n", ui.indexOf("function renderTeamToday()")))
    expect(render).toContain("summarizeTeamToday(")
    // No inner scroll frame, no table, no disclosure widget, no extra aside.
    expect(team).not.toMatch(/overflow-y-auto|overflow-x-auto|overflow-auto|max-h-|sticky|<table\b|<details\b|<aside\b/)
    // The summary stands above the filters: first fact above the fold. While
    // `query` is still null (SSR and the first client frame) the layout comes
    // from the URL, so hydration does not swap the week heading and five
    // skeletons for it on /mtm, and a deep link `/mtm?weekAgentId=…` does not
    // announce a team load it never requests. The summary hides only when the
    // bootstrap named a refusal the team request repeats (403, 404): a timeout
    // or a 429 on the filters does not hide three open shifts /week/team
    // already returned.
    const section = ui.indexOf('data-testid="mtm-operational-week"')
    expect(ui).toContain('const urlAgentId = searchParams.get("weekAgentId") || ""')
    expect(ui).toContain("const teamLayout = query ? teamViewActive : !urlAgentId")
    expect(ui).toContain('const bootstrapFailed = phase === "permission" || phase === "notFound"\n')
    expect(ui).not.toContain('const bootstrapFailed = phase === "permission" || phase === "notFound" || phase === "rateLimited"')
    const summaryCall = ui.indexOf("{teamLayout && !bootstrapFailed ? renderTeamToday() : null}", section)
    expect(summaryCall).toBeGreaterThan(section)
    expect(summaryCall).toBeLessThan(ui.indexOf("renderScopeControls(teamLayout)", section))
    expect(ui).not.toContain("renderScopeControls(teamViewActive)")
    expect(ui).toContain('(phase === "loading" || phase === "idle") && !teamLayout ?')
    // The section heading precedes the team heading in the compact layout,
    // and renderScopeControls no longer draws a second one.
    const sectionHeading = ui.indexOf('{teamLayout ? <h2 id="operational-week-title" className="sr-only">', section)
    expect(sectionHeading).toBeGreaterThan(section)
    expect(sectionHeading).toBeLessThan(summaryCall)
    expect(ui.match(/id="operational-week-title"/g)).toHaveLength(2)
    // Numbers are shown only for the filters on screen: the payload carries
    // its scope, and a summary of another scope is not read under new filters.
    expect(render).toContain("const scoped = currentTeamToday")
    expect(ui).toContain("const currentTeamToday = teamTodayForScope(teamToday, teamScopeKey)")
    expect(ui).toContain("normalizeTeamToday(body, scopeKey)")
    expect(render).not.toContain("if (!query) return null")
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

  // Owner 2026-10-11, the Panel on a Sunday evening: «разве это должно быть на
  // главном?». What waits for the manager stands first; the day's list, the
  // week line and the filters follow. Rows, never tiles.
  it("puts «ждёт решения» above the team's day, the week line under it, and draws no empty filter", () => {
    const section = ui.indexOf('data-testid="mtm-operational-week"')
    const attention = ui.indexOf("<MtmPanelAttention ", section)
    const summaryCall = ui.indexOf("{teamLayout && !bootstrapFailed ? renderTeamToday() : null}", section)
    expect(attention).toBeGreaterThan(section)
    expect(attention).toBeLessThan(summaryCall)
    // Drawn for the team view only, and with the filters on screen.
    expect(ui).toContain("{teamLayout && !bootstrapFailed && query ? (\n        <MtmPanelAttention organizationId={organizationId} viewerId={viewerId} regionId={query.regionId} teamId={query.teamId} refreshToken={refreshToken} />")
    const render = ui.slice(ui.indexOf("function renderTeamToday()"), ui.indexOf("\n  }\n", ui.indexOf("function renderTeamToday()")))
    expect(render.indexOf("<MtmPanelWeekLine ")).toBeGreaterThan(render.indexOf("summary.idle.map"))
    expect(render).toContain('t("summaryLastVisit"')
    // A team of office cards is not «no employees».
    expect(render).toContain('scoped.rows.length === 0 ? t("noEmployeesTitle") : t("noFieldStaff")')
    expect(ui).toContain("const regionField = filters.regions.length > 0 || query?.regionId ? (")
    expect(ui).toContain("const teamField = filters.teams.length > 0 || query?.teamId ? (")
    for (const file of ["src/components/mtm/panel-attention.tsx", "src/components/mtm/panel-week-line.tsx"]) {
      const source = readFileSync(file, "utf8")
      expect(source, file).not.toMatch(/overflow-y-auto|overflow-x-auto|overflow-auto|max-h-|sticky|<table\b|<details\b|<aside\b|grid-cols/)
    }
    // Shifts are Workforce, withdrawn from the CRM on 2026-10-10: not a row here.
    expect(readFileSync("src/app/api/v1/mtm/week/attention/route.ts", "utf8")).not.toContain("mtmAgentWorkday")
  })

  it("keeps every count of «ждёт решения» an ICU argument with the plural forms of each locale", () => {
    const plural = ["contactCreateRequests", "customerCreateRequests", "routeChangeRequests", "routesAwaitingPublish", "olderAlerts"]
    for (const key of plural) {
      const ru: string = messages.ru.mtmDashboardPage.operationalWeek.attention[key]
      for (const form of ["one {", "few {", "many {", "other {"]) expect(ru, `ru ${key} ${form}`).toContain(form)
      for (const locale of ["az", "en"]) {
        const text: string = messages[locale].mtmDashboardPage.operationalWeek.attention[key]
        expect(text, `${locale} ${key}`).toContain("one {")
        expect(text, `${locale} ${key}`).toContain("other {")
      }
    }
    const ruUnplanned: string = messages.ru.mtmDashboardPage.operationalWeek.week.unplanned
    for (const form of ["one {", "few {", "many {", "other {"]) expect(ruUnplanned).toContain(form)
    for (const locale of ["az", "ru", "en"]) {
      const words = messages[locale].mtmDashboardPage.operationalWeek
      for (const key of ["waitingSince", "nearestDay", "newestDay", "nextWorkdaySingle"]) expect(words.attention[key], `${locale} ${key}`).toContain("{date}")
      for (const key of ["nextWorkdayNobody", "nextWorkdaySome"]) {
        expect(words.attention[key], `${locale} ${key}`).toContain("{date}")
        expect(words.attention[key], `${locale} ${key}`).toContain("{total}")
      }
      expect(words.attention.nextWorkdaySome).toContain("{count}")
      expect(words.week.plan).toContain("{done}")
      expect(words.week.plan).toContain("{planned}")
      expect(words.summaryLastVisit).toContain("{date}")
      // Every row ends in a button with words on it, never an icon alone.
      for (const key of ["review", "publish", "resolve", "plan", "retry"]) expect(words.attention[key].length, `${locale} ${key}`).toBeGreaterThan(2)
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
