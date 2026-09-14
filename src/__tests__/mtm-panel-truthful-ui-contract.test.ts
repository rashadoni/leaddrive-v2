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
  it("opens on the team-today table instead of a blank picker, and a row opens the week", () => {
    expect(ui).toContain("/api/v1/mtm/week/team?")
    expect(ui).toContain('data-testid="mtm-week-team-today"')
    expect(ui).toContain("updateQuery({ ...query, agentId: row.agentId")
    // Wide table scrolls in its own wrapper; no vertical inner scroll frame.
    const table = ui.slice(ui.indexOf('data-testid="mtm-week-team-today"'), ui.indexOf("</table>"))
    expect(table).toContain('<div className="overflow-x-auto">')
    expect(table).not.toMatch(/overflow-y-auto|max-h-/)
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
    expect(ui).toContain("if (day.isToday && facts?.managerWorkday)")
  })

  it("names routes by date, numbers stops from 1, hides task ids for managers and words empty days by date", () => {
    expect(ui).not.toContain('firstString(source, "name", "title") || id')
    expect(ui).toContain('t("routeFallbackName"')
    expect(ui).toContain("renderPoint(point, day, index + 1)")
    expect(ui).not.toContain("{point.order}")
    expect(ui).toMatch(/\{!managerView \? \(\s*<p className="mt-1 text-\[11px\] text-muted-foreground" title=\{task\.id\}/)
    expect(ui).toContain('"noPublishedPlanFuture"')
    expect(ui).toContain('"noPublishedPlanPast"')
  })

  it("puts visit evidence on point cards as counts, never note text", () => {
    const evidence = ui.slice(ui.indexOf('data-testid="mtm-week-visit-evidence"'), ui.indexOf("</p>", ui.indexOf('data-testid="mtm-week-visit-evidence"')))
    for (const key of ["visitEvidence.inOut", "visitEvidence.minutes", "visitEvidence.photos", "visitEvidence.signature", "visitEvidence.note"]) {
      expect(evidence).toContain(key)
    }
    expect(evidence).not.toContain("cancellationReason")
    expect(ui).toContain("`/mtm/visits?visitId=${encodeURIComponent(point.visitId)}`")
  })

  it("speaks to a supervisor at the top of the page and drops the legacy block", () => {
    expect(page).not.toContain("<details")
    for (const locale of ["az", "ru", "en"]) {
      const hint: string = messages[locale].mtmDashboardPage.nextStepHint
      expect(hint).not.toMatch(/vizitləri tamamlayın|выполните визиты|complete visits/)
    }
    expect(messages.az.mtmDashboardPage.operationalWeek.workdayLeftOpen).toBe("Növbə {date} {time}-dən açıqdır ({duration}) — agent bağlamayıb")
  })
})
