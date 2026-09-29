import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  WORKFORCE_CALENDAR_EDITOR_KINDS,
  beginLatestCalendarRequest,
  finishLatestCalendarRequest,
  isLatestCalendarRequest,
} from "@/components/workforce/workforce-calendar-configuration"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).workforceCalendarConfiguration as Record<string, unknown>
}

describe("Workforce calendar configuration UI contract", () => {
  const component = source("src/components/workforce/workforce-calendar-configuration.tsx")
  const page = source("src/app/(dashboard)/workforce/calendar/page.tsx")
  const broadConfigurationPage = source("src/app/(dashboard)/workforce/configuration/page.tsx")
  const navigation = source("src/lib/nav-items.ts")

  it("mounts a separate Scheduler-visible surface on a dedicated calendar page", () => {
    expect(page).toContain("<WorkforceCalendarConfiguration />")
    expect(broadConfigurationPage).not.toContain("<WorkforceCalendarConfiguration />")
    expect(navigation).toContain('{ href: "/workforce/calendar", icon: CalendarDays, tKey: "workforceCalendar", group: "HRM", capability: "workforce-hrm" }')
    expect(navigation).toContain("legacy CRM permissionScope")
    expect(component).toContain('request<CalendarData>("GET", undefined, requestSelection, attempt.controller.signal)')
    expect(component).toContain('request<Record<string, unknown>>("POST", {')
    expect(component).toContain('/api/v1/workforce/configuration/calendar')
    expect(component).not.toContain("/api/v1/mtm/work-calendar")
    expect(component).not.toContain("isAdministrator")
    expect(component).not.toContain('role === "admin"')
  })

  it("reports an unknown POST outcome without falsely claiming no mutation", () => {
    expect(component).toContain("localizedMutationFailure")
    expect(component).toContain("setError(localizedMutationFailure(t, failure))")
    expect(component).toContain('return t("outcomeUnknown")')
    expect(component).toContain("exact-state retry contract")
  })

  it("lets only the newest scope, team or search request commit and finish loading", () => {
    const state = { sequence: 0, controller: null as AbortController | null }
    const organizationAttempt = beginLatestCalendarRequest(state)
    const teamAttempt = beginLatestCalendarRequest(state)

    expect(organizationAttempt.controller.signal.aborted).toBe(true)
    expect(isLatestCalendarRequest(state, organizationAttempt)).toBe(false)
    expect(finishLatestCalendarRequest(state, organizationAttempt)).toBe(false)
    expect(isLatestCalendarRequest(state, teamAttempt)).toBe(true)
    expect(finishLatestCalendarRequest(state, teamAttempt)).toBe(true)
    expect(state.controller).toBeNull()
  })

  it("offers only the three released additive organization/team/employee override kinds", () => {
    expect(WORKFORCE_CALENDAR_EDITOR_KINDS).toEqual([
      "PUBLIC_HOLIDAY",
      "COMPANY_HOLIDAY",
      "EXCEPTION_WORKDAY",
    ])
    expect(component).not.toContain('value="MOVED_WORKDAY"')
    expect(component).not.toContain('value="MOVED_DAY_OFF"')
    expect(component).not.toContain('value="WORKING_DAY"')
  })

  it("uses named inputs, inline feedback, touch targets and responsive divider rhythm", () => {
    expect(component).toContain('id="workforce-calendar-scope"')
    expect(component).toContain('id="workforce-calendar-team"')
    expect(component).toContain('id="workforce-calendar-team-search"')
    expect(component).toContain('id="workforce-calendar-agent"')
    expect(component).toContain('id="workforce-calendar-agent-search"')
    expect(component).toContain('id="workforce-calendar-date"')
    expect(component).toContain('id="workforce-calendar-kind"')
    expect(component).toContain('id="workforce-calendar-name"')
    expect(component).toContain('className="min-h-11"')
    expect(component).toContain("md:grid-cols-3")
    expect(component).toContain('role="alert"')
    expect(component).toContain('role="status" aria-live="polite"')
    expect(component).toContain("divide-y divide-zinc-200")
    expect(component).toContain("motion-reduce:animate-none")
  })

  it("freezes every selection and draft control until a submitted mutation is reconciled", () => {
    expect(component.match(/disabled=\{saving\}/g)).toHaveLength(8)
    for (const control of [
      "workforce-calendar-scope",
      "workforce-calendar-team",
      "workforce-calendar-team-search",
      "workforce-calendar-agent",
      "workforce-calendar-agent-search",
      "workforce-calendar-date",
      "workforce-calendar-kind",
      "workforce-calendar-name",
    ]) {
      const controlSource = component.slice(component.indexOf(`id=\"${control}\"`))
      expect(controlSource.slice(0, 320), `${control} must be frozen while saving`).toContain("disabled={saving}")
    }
  })

  it("uses named bounded target pickers and keeps PII, storage and Route fields out of the browser", () => {
    expect(component).toContain('team.name')
    expect(component).toContain('team.code')
    expect(component).toContain('maxLength={100}')
    expect(component).toContain('teamDirectory.hasMore')
    expect(component).toContain('agent.name')
    expect(component).toContain('agent.externalCode')
    expect(component).toContain('agentDirectory.hasMore')
    expect(component).toContain('submittedSelection.scope === "AGENT" ? { agentId: submittedSelection.agentId } : {}')
    expect(component).not.toMatch(/\bemail\b/)
    expect(component).not.toMatch(/\bphone\b/)
    expect(component).not.toMatch(/\bpasswordHash\b/)
    expect(component).not.toMatch(/\bmovedToDate\b/)
    expect(component).not.toMatch(/\broutePlanningAllowed\b/)
    expect(component).not.toMatch(/\bcreatedBy\b/)
    expect(component).not.toContain('source: "ADMIN"')
  })

  it("uses a non-sensitive employee display-label contract instead of inviting HR reasons", () => {
    expect(component).toContain('t(scope === "AGENT" ? "agentName" : "name")')
    expect(component).toContain('t(scope === "AGENT" ? "agentNamePlaceholder" : "namePlaceholder")')
    expect(component).toContain('aria-describedby={scope === "AGENT" ? "workforce-calendar-agent-name-hint" : undefined}')
    expect(component).toContain('id="workforce-calendar-agent-name-hint"')
    expect(messages("en").agentName).toBe("Non-sensitive display label")
    expect(messages("en").agentNameHint).toContain("Do not enter leave, absence, medical")
    expect(messages("en").createHintAgent).toContain("visible to schedule readers and retained in audit")
  })

  it("has complete non-empty EN, RU and AZ copy including every readable kind", () => {
    const keys = [
      "title",
      "subtitle",
      "refresh",
      "loading",
      "scope",
      "organizationScopeHint",
      "teamScopeHint",
      "agentScopeHint",
      "team",
      "selectTeam",
      "inactiveTeam",
      "teamSearch",
      "teamSearchPlaceholder",
      "searchTeams",
      "teamSearchNarrower",
      "noTeams",
      "selectTeamHint",
      "teamInactive",
      "agent",
      "selectAgent",
      "agentSearch",
      "agentSearchPlaceholder",
      "searchAgents",
      "agentSearchNarrower",
      "noAgents",
      "selectAgentHint",
      "agentInactive",
      "agentContext",
      "noCurrentTeam",
      "agentName",
      "agentNamePlaceholder",
      "agentNameHint",
      "date",
      "kind",
      "name",
      "namePlaceholder",
      "createHintOrganization",
      "createHintTeam",
      "createHintAgent",
      "create",
      "createdOrganization",
      "createdTeam",
      "createdAgent",
      "alreadyRecorded",
      "upcomingTitleOrganization",
      "upcomingTitleTeam",
      "upcomingTitleAgent",
      "upcomingHint",
      "emptyOrganization",
      "emptyTeam",
      "emptyAgent",
      "unnamed",
      "dateNotFuture",
      "dateRangeInvalid",
      "overrideExists",
      "teamUnavailable",
      "teamSearchInvalid",
      "agentUnavailable",
      "agentSearchInvalid",
      "scopeInvalid",
      "invalidInput",
      "accessRequired",
      "requestFailed",
      "outcomeUnknown",
    ]
    for (const locale of ["en", "ru", "az"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
      const kinds = localized.kinds as Record<string, unknown>
      const scopes = localized.scopes as Record<string, unknown>
      expect(scopes.ORGANIZATION).toEqual(expect.any(String))
      expect(scopes.TEAM).toEqual(expect.any(String))
      expect(scopes.AGENT).toEqual(expect.any(String))
      const statuses = localized.agentStatuses as Record<string, unknown>
      for (const status of ["ACTIVE", "INACTIVE", "SUSPENDED"]) {
        expect(statuses[status], `${locale}.agentStatuses.${status} is missing`).toEqual(expect.any(String))
      }
      expect(localized.outcomeUnknown).not.toBe(localized.requestFailed)
      for (const kind of [
        "WORKING_DAY",
        "WEEKEND",
        "PUBLIC_HOLIDAY",
        "COMPANY_HOLIDAY",
        "EXCEPTION_WORKDAY",
        "MOVED_WORKDAY",
        "MOVED_DAY_OFF",
      ]) {
        expect(kinds[kind], `${locale}.kinds.${kind} is missing`).toEqual(expect.any(String))
      }
    }
    expect(messages("en").requestFailed).not.toContain("No calendar day was changed")
  })
})
