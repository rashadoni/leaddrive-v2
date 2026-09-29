"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { CalendarDays, Loader2, Plus, RefreshCw, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type {
  WorkforceCalendarAgentSummary,
  WorkforceCalendarConfigurationScope,
  WorkforceCalendarCreateKind,
  WorkforceCalendarOverrideSummary,
  WorkforceCalendarTeamSummary,
} from "@/lib/workforce/calendar-configuration-contract"

export const WORKFORCE_CALENDAR_EDITOR_KINDS = [
  "PUBLIC_HOLIDAY",
  "COMPANY_HOLIDAY",
  "EXCEPTION_WORKDAY",
] as const satisfies readonly WorkforceCalendarCreateKind[]

type TeamDirectory = {
  items: WorkforceCalendarTeamSummary[]
  query: string
  limit: number
  hasMore: boolean
}

type AgentDirectory = {
  items: WorkforceCalendarAgentSummary[]
  query: string
  limit: number
  hasMore: boolean
}

type CalendarData = {
  timezone: string
  currentDate: string
  start: string
  endExclusive: string
  scope: WorkforceCalendarConfigurationScope
  team: WorkforceCalendarTeamSummary | null
  agent: WorkforceCalendarAgentSummary | null
  teamDirectory: TeamDirectory
  agentDirectory: AgentDirectory
  days: WorkforceCalendarOverrideSummary[]
}

type ReadSelection = {
  scope: WorkforceCalendarConfigurationScope
  teamId: string
  teamQuery: string
  agentId: string
  agentQuery: string
}

type ApiFailure = Error & { code?: string }

type LatestCalendarRequestState = {
  sequence: number
  controller: AbortController | null
}

export type CalendarLoadAttempt = {
  sequence: number
  controller: AbortController
}

export function beginLatestCalendarRequest(state: LatestCalendarRequestState): CalendarLoadAttempt {
  state.controller?.abort()
  const controller = new AbortController()
  state.sequence += 1
  state.controller = controller
  return { sequence: state.sequence, controller }
}

export function isLatestCalendarRequest(
  state: LatestCalendarRequestState,
  attempt: CalendarLoadAttempt,
): boolean {
  return state.sequence === attempt.sequence
    && state.controller === attempt.controller
    && !attempt.controller.signal.aborted
}

export function finishLatestCalendarRequest(
  state: LatestCalendarRequestState,
  attempt: CalendarLoadAttempt,
): boolean {
  if (!isLatestCalendarRequest(state, attempt)) return false
  state.controller = null
  return true
}

function nextDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function failureCode(failure: unknown): string {
  return failure && typeof failure === "object" && "code" in failure
    ? String((failure as { code?: unknown }).code ?? "")
    : ""
}

function localizedKnownFailure(t: ReturnType<typeof useTranslations>, code: string): string | null {
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE") return t("dateNotFuture")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID") return t("dateRangeInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS") return t("overrideExists")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE") return t("teamUnavailable")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_SEARCH_INVALID") return t("teamSearchInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE") return t("agentUnavailable")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_SEARCH_INVALID") return t("agentSearchInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID") return t("scopeInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_INVALID") return t("invalidInput")
  if ([
    "WORKFORCE_GRANULAR_ACCESS_REQUIRED",
    "WORKFORCE_POLICY_ADMIN_REQUIRED",
    "WORKFORCE_SESSION_PERMISSION_REQUIRED",
    "TENANT_CAPABILITY_DISABLED",
  ].includes(code)) return t("accessRequired")
  return null
}

function localizedReadFailure(t: ReturnType<typeof useTranslations>, failure: unknown): string {
  const known = localizedKnownFailure(t, failureCode(failure))
  if (known) return known
  return t("requestFailed")
}

function localizedMutationFailure(t: ReturnType<typeof useTranslations>, failure: unknown): string {
  const known = localizedKnownFailure(t, failureCode(failure))
  if (known) return known
  // A transport or parse failure can happen after the server committed. The
  // exact-state retry contract makes refresh/resubmit safe; never claim that
  // an unknown mutation outcome left the calendar unchanged.
  return t("outcomeUnknown")
}

/**
 * Forward-only organization/team/employee calendar editor. Authorization
 * remains in the API so a granular Scheduler is not hidden behind the legacy
 * CRM role.
 */
export function WorkforceCalendarConfiguration() {
  const { data: session } = useSession()
  const t = useTranslations("workforceCalendarConfiguration")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const [calendar, setCalendar] = useState<CalendarData | null>(null)
  const [scope, setScope] = useState<WorkforceCalendarConfigurationScope>("ORGANIZATION")
  const [teamId, setTeamId] = useState("")
  const [teamQuery, setTeamQuery] = useState("")
  const [agentId, setAgentId] = useState("")
  const [agentQuery, setAgentQuery] = useState("")
  const [date, setDate] = useState("")
  const [kind, setKind] = useState<WorkforceCalendarCreateKind>("PUBLIC_HOLIDAY")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const latestLoad = useRef<LatestCalendarRequestState>({ sequence: 0, controller: null })
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }), [])

  const request = useCallback(async function requestCalendar<T>(
    method: "GET" | "POST",
    body?: unknown,
    selection?: ReadSelection,
    signal?: AbortSignal,
  ): Promise<{ data: T; status: number }> {
    if (!organizationId) throw new Error("organization-unavailable")
    const query = new URLSearchParams()
    if (method === "GET" && selection) {
      query.set("scope", selection.scope)
      if (selection.scope === "TEAM" && selection.teamId) query.set("teamId", selection.teamId)
      if (selection.scope === "AGENT" && selection.agentId) query.set("agentId", selection.agentId)
      if (selection.teamQuery.trim()) query.set("teamQuery", selection.teamQuery.trim())
      if (selection.agentQuery.trim()) query.set("agentQuery", selection.agentQuery.trim())
    }
    const queryString = query.toString()
    const response = await fetch(
      `/api/v1/workforce/configuration/calendar${queryString ? `?${queryString}` : ""}`,
      {
        method,
        headers: {
          "x-organization-id": organizationId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      },
    )
    const payload = await response.json().catch(() => ({})) as {
      success?: boolean
      code?: string
      data?: T
    }
    if (!response.ok || !payload.success || !payload.data) {
      const failure = new Error("workforce-calendar-request-failed") as ApiFailure
      failure.code = payload.code
      throw failure
    }
    return { data: payload.data, status: response.status }
  }, [organizationId])

  const load = useCallback(async (selection: ReadSelection) => {
    const attempt = beginLatestCalendarRequest(latestLoad.current)
    if (!organizationId) {
      if (finishLatestCalendarRequest(latestLoad.current, attempt)) setLoading(false)
      return
    }
    setLoading(true)
    try {
      const requestSelection = (selection.scope === "TEAM" && !selection.teamId)
        || (selection.scope === "AGENT" && !selection.agentId)
        ? { ...selection, scope: "ORGANIZATION" as const }
        : selection
      const result = await request<CalendarData>("GET", undefined, requestSelection, attempt.controller.signal)
      if (!isLatestCalendarRequest(latestLoad.current, attempt)) return
      setCalendar(result.data)
      setDate((current) => current > result.data.currentDate ? current : nextDateKey(result.data.currentDate))
      setError(null)
    } catch (failure) {
      if (!isLatestCalendarRequest(latestLoad.current, attempt)) return
      setCalendar(null)
      setError(localizedReadFailure(t, failure))
    } finally {
      if (finishLatestCalendarRequest(latestLoad.current, attempt)) setLoading(false)
    }
  }, [organizationId, request, t])

  useEffect(() => () => {
    latestLoad.current.controller?.abort()
  }, [])

  useEffect(() => {
    setScope("ORGANIZATION")
    setTeamId("")
    setTeamQuery("")
    setAgentId("")
    setAgentQuery("")
    void load({
      scope: "ORGANIZATION",
      teamId: "",
      teamQuery: "",
      agentId: "",
      agentQuery: "",
    })
  }, [load])

  async function createOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    const submittedSelection: ReadSelection = { scope, teamId, teamQuery, agentId, agentQuery }
    try {
      const result = await request<Record<string, unknown>>("POST", {
        scope: submittedSelection.scope,
        ...(submittedSelection.scope === "TEAM" ? { teamId: submittedSelection.teamId } : {}),
        ...(submittedSelection.scope === "AGENT" ? { agentId: submittedSelection.agentId } : {}),
        date,
        kind,
        name,
      })
      setNotice(result.status === 201
        ? t(submittedSelection.scope === "TEAM"
            ? "createdTeam"
            : submittedSelection.scope === "AGENT"
              ? "createdAgent"
              : "createdOrganization")
        : t("alreadyRecorded"))
      setName("")
      await load(submittedSelection)
    } catch (failure) {
      setError(localizedMutationFailure(t, failure))
    } finally {
      setSaving(false)
    }
  }

  if (!organizationId) return null

  const teamOptions = [...(calendar?.teamDirectory.items ?? [])]
  if (calendar?.team && !teamOptions.some((team) => team.id === calendar.team?.id)) {
    teamOptions.unshift(calendar.team)
  }
  const agentOptions = [...(calendar?.agentDirectory.items ?? [])]
  if (calendar?.agent && !agentOptions.some((agent) => agent.id === calendar.agent?.id)) {
    agentOptions.unshift(calendar.agent)
  }
  const visibleCalendar = calendar
    && calendar.scope === scope
    && (
      scope === "ORGANIZATION"
      || (scope === "TEAM" && calendar.team?.id === teamId)
      || (scope === "AGENT" && calendar.agent?.id === agentId)
    )
    ? calendar
    : null
  const minimumDate = visibleCalendar ? nextDateKey(visibleCalendar.currentDate) : undefined
  const selectedTeam = scope === "TEAM" && visibleCalendar ? visibleCalendar.team : null
  const selectedAgent = scope === "AGENT" && visibleCalendar ? visibleCalendar.agent : null
  const canCreate = Boolean(
    visibleCalendar
    && (
      scope === "ORGANIZATION"
      || selectedTeam?.isActive
      || selectedAgent?.status === "ACTIVE"
    )
    && date
    && name.trim(),
  )

  return <section
    className="overflow-hidden rounded-xl border border-zinc-200 bg-background dark:border-zinc-800"
    aria-labelledby="workforce-calendar-configuration-title"
    aria-busy={loading || saving}
  >
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6">
      <div className="flex max-w-3xl gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 id="workforce-calendar-configuration-title" className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
        disabled={loading || saving}
      >
        {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
        {t("refresh")}
      </Button>
    </div>

    {error ? <p className="border-b border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 sm:px-6" role="alert">{error}</p> : null}
    {notice ? <p className="border-b border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-6" role="status" aria-live="polite">{notice}</p> : null}

    <div className="grid gap-5 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6 lg:grid-cols-2">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-scope">{t("scope")}</label>
        <Select
          id="workforce-calendar-scope"
          className="min-h-11"
          value={scope}
          disabled={saving}
          onChange={(event) => {
            const nextScope = event.target.value as WorkforceCalendarConfigurationScope
            setScope(nextScope)
            setTeamId("")
            setTeamQuery("")
            setAgentId("")
            setAgentQuery("")
            setNotice(null)
            void load({
              scope: nextScope,
              teamId: "",
              teamQuery: "",
              agentId: "",
              agentQuery: "",
            })
          }}
        >
          <option value="ORGANIZATION">{t("scopes.ORGANIZATION")}</option>
          <option value="TEAM">{t("scopes.TEAM")}</option>
          <option value="AGENT">{t("scopes.AGENT")}</option>
        </Select>
        <p className="text-xs leading-5 text-muted-foreground">{t(scope === "TEAM"
          ? "teamScopeHint"
          : scope === "AGENT"
            ? "agentScopeHint"
            : "organizationScopeHint")}</p>
      </div>

      {scope === "TEAM" ? <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-team">{t("team")}</label>
        <Select
          id="workforce-calendar-team"
          className="min-h-11"
          value={teamId}
          disabled={saving}
          onChange={(event) => {
            const nextTeamId = event.target.value
            setTeamId(nextTeamId)
            setNotice(null)
            if (nextTeamId) void load({
              scope: "TEAM",
              teamId: nextTeamId,
              teamQuery,
              agentId: "",
              agentQuery: "",
            })
          }}
          required
        >
          <option value="">{t("selectTeam")}</option>
          {teamOptions.map((team) => <option key={team.id} value={team.id}>
            {team.name}{team.code ? ` · ${team.code}` : ""}{team.isActive ? "" : ` · ${t("inactiveTeam")}`}
          </option>)}
        </Select>
      </div> : null}

      {scope === "TEAM" ? <div className="space-y-2 lg:col-span-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-team-search">{t("teamSearch")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="workforce-calendar-team-search"
            className="min-h-11"
            value={teamQuery}
            disabled={saving}
            onChange={(event) => setTeamQuery(event.target.value)}
            maxLength={100}
            placeholder={t("teamSearchPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:shrink-0"
            onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
            disabled={loading || saving}
          >
            <Search aria-hidden="true" />
            {t("searchTeams")}
          </Button>
        </div>
        {calendar?.teamDirectory.hasMore ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("teamSearchNarrower")}</p> : null}
        {!loading && calendar && calendar.teamDirectory.items.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">{t("noTeams")}</p> : null}
      </div> : null}

      {scope === "AGENT" ? <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-agent">{t("agent")}</label>
        <Select
          id="workforce-calendar-agent"
          className="min-h-11"
          value={agentId}
          disabled={saving}
          onChange={(event) => {
            const nextAgentId = event.target.value
            setAgentId(nextAgentId)
            setNotice(null)
            if (nextAgentId) void load({
              scope: "AGENT",
              teamId: "",
              teamQuery: "",
              agentId: nextAgentId,
              agentQuery,
            })
          }}
          required
        >
          <option value="">{t("selectAgent")}</option>
          {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>
            {agent.name}{agent.externalCode ? ` · ${agent.externalCode}` : ""} · {t(`agentStatuses.${agent.status}`)}
          </option>)}
        </Select>
        {selectedAgent ? <p className="text-xs leading-5 text-muted-foreground">{t("agentContext", {
          status: t(`agentStatuses.${selectedAgent.status}`),
          team: selectedAgent.currentTeam
            ? `${selectedAgent.currentTeam.name}${selectedAgent.currentTeam.code ? ` · ${selectedAgent.currentTeam.code}` : ""}`
            : t("noCurrentTeam"),
        })}</p> : null}
      </div> : null}

      {scope === "AGENT" ? <div className="space-y-2 lg:col-span-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-agent-search">{t("agentSearch")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="workforce-calendar-agent-search"
            className="min-h-11"
            value={agentQuery}
            disabled={saving}
            onChange={(event) => setAgentQuery(event.target.value)}
            maxLength={100}
            placeholder={t("agentSearchPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:shrink-0"
            onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
            disabled={loading || saving}
          >
            <Search aria-hidden="true" />
            {t("searchAgents")}
          </Button>
        </div>
        {calendar?.agentDirectory.hasMore ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("agentSearchNarrower")}</p> : null}
        {!loading && calendar && calendar.agentDirectory.items.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">{t("noAgents")}</p> : null}
      </div> : null}
    </div>

    {scope === "TEAM" && selectedTeam && !selectedTeam.isActive
      ? <p className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 sm:px-6" role="alert">{t("teamInactive")}</p>
      : null}
    {scope === "AGENT" && selectedAgent && selectedAgent.status !== "ACTIVE"
      ? <p className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 sm:px-6" role="alert">{t("agentInactive")}</p>
      : null}

    {visibleCalendar ? <>
      <form className="grid gap-5 px-5 py-6 sm:px-6 md:grid-cols-3" onSubmit={createOverride}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-date">{t("date")}</label>
          <Input
            id="workforce-calendar-date"
            type="date"
            className="min-h-11"
            min={minimumDate}
            max={previousDateKey(visibleCalendar.endExclusive)}
            value={date}
            disabled={saving}
            onChange={(event) => { setDate(event.target.value); setNotice(null) }}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-kind">{t("kind")}</label>
          <Select
            id="workforce-calendar-kind"
            className="min-h-11"
            value={kind}
            disabled={saving}
            onChange={(event) => { setKind(event.target.value as WorkforceCalendarCreateKind); setNotice(null) }}
          >
            {WORKFORCE_CALENDAR_EDITOR_KINDS.map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-name">{t("name")}</label>
          <Input
            id="workforce-calendar-name"
            className="min-h-11"
            value={name}
            disabled={saving}
            onChange={(event) => { setName(event.target.value); setNotice(null) }}
            maxLength={160}
            placeholder={t("namePlaceholder")}
            required
          />
        </div>
        <div className="md:col-span-3">
          <p className="mb-4 text-sm leading-6 text-muted-foreground">{
            scope === "TEAM" && selectedTeam
              ? t("createHintTeam", { timezone: visibleCalendar.timezone, team: selectedTeam.name })
              : scope === "AGENT" && selectedAgent
                ? t("createHintAgent", { timezone: visibleCalendar.timezone, agent: selectedAgent.name })
                : t("createHintOrganization", { timezone: visibleCalendar.timezone })
          }</p>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={saving || loading || !canCreate}>
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
            {t("create")}
          </Button>
        </div>
      </form>

      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="px-5 py-5 sm:px-6">
          <h3 className="font-semibold">{
            scope === "TEAM" && selectedTeam
              ? t("upcomingTitleTeam", { team: selectedTeam.name })
              : scope === "AGENT" && selectedAgent
                ? t("upcomingTitleAgent", { agent: selectedAgent.name })
                : t("upcomingTitleOrganization")
          }</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("upcomingHint", { timezone: visibleCalendar.timezone })}</p>
        </div>
        {visibleCalendar.days.length === 0
          ? <p className="border-t border-zinc-200 px-5 py-8 text-sm text-muted-foreground dark:border-zinc-800 sm:px-6">{t(scope === "TEAM"
              ? "emptyTeam"
              : scope === "AGENT"
                ? "emptyAgent"
                : "emptyOrganization")}</p>
          : <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {visibleCalendar.days.map((day) => <li key={`${day.date}:${day.kind}`} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="font-medium">{day.name || t("unnamed")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}</p>
              </div>
              <Badge variant="secondary" className="w-fit">{t(`kinds.${day.kind}`)}</Badge>
            </li>)}
          </ul>}
      </div>
    </> : loading
      ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground sm:px-6"><Loader2 className="animate-spin motion-reduce:animate-none" />{t("loading")}</div>
      : scope === "TEAM" && !teamId
        ? <p className="px-5 py-8 text-sm leading-6 text-muted-foreground sm:px-6">{t("selectTeamHint")}</p>
        : scope === "AGENT" && !agentId
          ? <p className="px-5 py-8 text-sm leading-6 text-muted-foreground sm:px-6">{t("selectAgentHint")}</p>
          : null}
  </section>
}
