"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
  WorkforceCalendarMovedDayReverseDraft,
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
type CalendarEditorOperation = "CREATE_OVERRIDE" | "MOVE_WORKDAY"

type CalendarMutationIdentity = { contextKey: string; targetKey: string }
type CalendarMutationState = { current: CalendarMutationIdentity | null }
type ReversalConfirmation = CalendarMutationIdentity & {
  draft: WorkforceCalendarMovedDayReverseDraft
  selection: ReadSelection
  label: string
  scopeLabel: string
}

export function beginCalendarMutation(state: CalendarMutationState, identity: CalendarMutationIdentity): CalendarMutationIdentity | null {
  if (state.current) return null
  const attempt = { ...identity }
  state.current = attempt
  return attempt
}

export function isCurrentCalendarMutation(
  state: CalendarMutationState, attempt: CalendarMutationIdentity, identity: CalendarMutationIdentity,
): boolean {
  return state.current === attempt && attempt.contextKey === identity.contextKey && attempt.targetKey === identity.targetKey
}

export function finishCalendarMutation(state: CalendarMutationState, attempt: CalendarMutationIdentity): boolean {
  if (state.current !== attempt) return false
  state.current = null
  return true
}

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
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID") return t("moveDatesInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_SOURCE_NOT_WORKING") return t("moveSourceNotWorking")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DESTINATION_NOT_NON_WORKING") return t("moveDestinationNotNonWorking")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS") return t("overrideExists")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED") return t("reversalPairChanged")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED") return t("reversalRouteChanged")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_BUSY") return t("reversalBusy")
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
  const contextKey = JSON.stringify([organizationId, session?.user?.id ?? ""])
  const [calendar, setCalendar] = useState<(CalendarData & { clientContextKey: string }) | null>(null)
  const [scope, setScope] = useState<WorkforceCalendarConfigurationScope>("ORGANIZATION")
  const [teamId, setTeamId] = useState("")
  const [teamQuery, setTeamQuery] = useState("")
  const [agentId, setAgentId] = useState("")
  const [agentQuery, setAgentQuery] = useState("")
  const [operation, setOperation] = useState<CalendarEditorOperation>("CREATE_OVERRIDE")
  const [date, setDate] = useState("")
  const [destinationDate, setDestinationDate] = useState("")
  const [kind, setKind] = useState<WorkforceCalendarCreateKind>("PUBLIC_HOLIDAY")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<ReversalConfirmation | null>(null)
  const confirmationTitle = useRef<HTMLHeadingElement | null>(null)
  const reversalError = useRef<HTMLParagraphElement | null>(null)
  const reversalSource = useRef<HTMLButtonElement | null>(null)
  const reversalResult = useRef<HTMLParagraphElement | null>(null)
  const reversalFocus = useRef<(CalendarMutationIdentity & { target: "source" | "result" }) | null>(null)
  const targetKey = JSON.stringify([scope, scope === "TEAM" ? teamId : null, scope === "AGENT" ? agentId : null])
  const activeIdentity = useRef<CalendarMutationIdentity>({ contextKey, targetKey })
  const mutation = useRef<CalendarMutationState>({ current: null })
  const latestLoad = useRef<LatestCalendarRequestState>({ sequence: 0, controller: null })
  useLayoutEffect(() => {
    if (activeIdentity.current.contextKey !== contextKey || activeIdentity.current.targetKey !== targetKey) {
      reversalFocus.current = null
      reversalSource.current = null
    }
    if (activeIdentity.current.contextKey !== contextKey) {
      mutation.current.current = null
      setSaving(false)
      setConfirmation(null)
      setCalendar(null)
      setError(null)
      setNotice(null)
    }
    activeIdentity.current = { contextKey, targetKey }
  }, [contextKey, targetKey])
  useEffect(() => {
    if (!confirmation || confirmation.contextKey !== contextKey || confirmation.targetKey !== targetKey) return
    // The source action may be far below this review in a narrow viewport.
    // Move keyboard focus and the scroll position to the newly opened review.
    confirmationTitle.current?.focus({ preventScroll: true })
    confirmationTitle.current?.parentElement?.scrollIntoView({ block: "start", behavior: "instant" })
  }, [confirmation, contextKey, targetKey])
  useEffect(() => {
    if (!error || !confirmation || confirmation.contextKey !== contextKey || confirmation.targetKey !== targetKey) return
    // A late failure can insert the retry explanation above the review.
    reversalError.current?.focus({ preventScroll: true })
    reversalError.current?.scrollIntoView({ block: "start", behavior: "instant" })
  }, [error, confirmation, contextKey, targetKey])
  useEffect(() => {
    const pending = reversalFocus.current
    if (!pending) return
    if (pending.contextKey !== contextKey || pending.targetKey !== targetKey) {
      reversalFocus.current = null
      return
    }
    if (confirmation || saving || loading) return
    const element = pending.target === "source" ? reversalSource.current : reversalResult.current
    reversalFocus.current = null
    if (!element?.isConnected) return
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: pending.target === "source" ? "nearest" : "start", behavior: "instant" })
  }, [confirmation, contextKey, targetKey, saving, loading, notice])
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
    // Fence before beginning: an old POST must not abort a new tenant's GET.
    if (activeIdentity.current.contextKey !== contextKey) return
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
      if (activeIdentity.current.contextKey !== contextKey || !isLatestCalendarRequest(latestLoad.current, attempt)) return
      setCalendar({ ...result.data, clientContextKey: contextKey })
      setDate((current) => current > result.data.currentDate ? current : nextDateKey(result.data.currentDate))
      setDestinationDate((current) => current > result.data.currentDate
        ? current
        : nextDateKey(nextDateKey(result.data.currentDate)))
      setError(null)
    } catch (failure) {
      if (activeIdentity.current.contextKey !== contextKey || !isLatestCalendarRequest(latestLoad.current, attempt)) return
      setCalendar(null)
      setError(localizedReadFailure(t, failure))
    } finally {
      if (finishLatestCalendarRequest(latestLoad.current, attempt)) setLoading(false)
    }
  }, [contextKey, organizationId, request, t])

  useEffect(() => () => {
    latestLoad.current.controller?.abort()
    mutation.current.current = null
  }, [])

  useEffect(() => {
    setScope("ORGANIZATION")
    setTeamId("")
    setTeamQuery("")
    setAgentId("")
    setAgentQuery("")
    setOperation("CREATE_OVERRIDE")
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
    if (confirmation) return
    const attempt = beginCalendarMutation(mutation.current, { contextKey, targetKey })
    if (!attempt) return
    setSaving(true)
    setError(null)
    setNotice(null)
    const submittedSelection: ReadSelection = { scope, teamId, teamQuery, agentId, agentQuery }
    const submittedOperation = operation
    try {
      const target = {
        scope: submittedSelection.scope,
        ...(submittedSelection.scope === "TEAM" ? { teamId: submittedSelection.teamId } : {}),
        ...(submittedSelection.scope === "AGENT" ? { agentId: submittedSelection.agentId } : {}),
      }
      const result = await request<Record<string, unknown>>("POST", submittedOperation === "MOVE_WORKDAY"
        ? {
            operation: "MOVE_WORKDAY",
            ...target,
            sourceDate: date,
            destinationDate,
            name,
          }
        : { ...target, date, kind, name })
      if (!isCurrentCalendarMutation(mutation.current, attempt, activeIdentity.current)) return
      setNotice(result.status === 201
        ? t(submittedOperation === "MOVE_WORKDAY"
            ? submittedSelection.scope === "TEAM" ? "movedTeam" : "movedOrganization"
            : submittedSelection.scope === "TEAM"
              ? "createdTeam"
              : submittedSelection.scope === "AGENT"
                ? "createdAgent"
                : "createdOrganization")
        : t("alreadyRecorded"))
      setName("")
      await load(submittedSelection)
    } catch (failure) {
      if (isCurrentCalendarMutation(mutation.current, attempt, activeIdentity.current)) setError(localizedMutationFailure(t, failure))
    } finally {
      if (finishCalendarMutation(mutation.current, attempt)) setSaving(false)
    }
  }

  function cancelReversal() {
    if (saving || !confirmation || confirmation.contextKey !== contextKey || confirmation.targetKey !== targetKey) return
    reversalFocus.current = { contextKey, targetKey, target: "source" }
    setConfirmation(null)
    setError(null)
  }

  async function reverseMovedDay() {
    if (!confirmation || confirmation.contextKey !== contextKey || confirmation.targetKey !== targetKey) return
    const submitted = confirmation
    const attempt = beginCalendarMutation(mutation.current, { contextKey, targetKey })
    if (!attempt) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await request<{
        pairGenerationId: string; sourceDate: string; destinationDate: string; reversed: boolean
      }>("POST", submitted.draft)
      if (!isCurrentCalendarMutation(mutation.current, attempt, activeIdentity.current)) return
      if (result.data.pairGenerationId !== submitted.draft.pairGenerationId
        || result.data.sourceDate !== submitted.draft.sourceDate
        || result.data.destinationDate !== submitted.draft.destinationDate
        || typeof result.data.reversed !== "boolean") throw new Error("unconfirmed-reversal")
      reversalFocus.current = { contextKey, targetKey, target: "result" }
      setNotice(t(result.data.reversed ? "reversalRecorded" : "reversalAlreadyRecorded"))
      setConfirmation(null)
      await load(submitted.selection)
    } catch (failure) {
      if (isCurrentCalendarMutation(mutation.current, attempt, activeIdentity.current)) {
        setError(localizedKnownFailure(t, failureCode(failure)) ?? t("reversalOutcomeUnknown"))
      }
    } finally {
      if (finishCalendarMutation(mutation.current, attempt)) setSaving(false)
    }
  }

  if (!organizationId) return null

  const contextCalendar = calendar?.clientContextKey === contextKey ? calendar : null
  const teamOptions = [...(contextCalendar?.teamDirectory.items ?? [])]
  if (contextCalendar?.team && !teamOptions.some((team) => team.id === contextCalendar.team?.id)) {
    teamOptions.unshift(contextCalendar.team)
  }
  const agentOptions = [...(contextCalendar?.agentDirectory.items ?? [])]
  if (contextCalendar?.agent && !agentOptions.some((agent) => agent.id === contextCalendar.agent?.id)) {
    agentOptions.unshift(contextCalendar.agent)
  }
  const visibleCalendar = contextCalendar
    && contextCalendar.scope === scope
    && (
      scope === "ORGANIZATION"
      || (scope === "TEAM" && contextCalendar.team?.id === teamId)
      || (scope === "AGENT" && contextCalendar.agent?.id === agentId)
    )
    ? contextCalendar
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
    && (operation === "CREATE_OVERRIDE" || (
      scope !== "AGENT"
      && destinationDate
      && destinationDate !== date
    ))
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
        className="h-auto min-h-11 max-w-full whitespace-normal"
        onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
        disabled={loading || saving || Boolean(confirmation)}
      >
        {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
        {t("refresh")}
      </Button>
    </div>

    {error ? <p ref={reversalError} tabIndex={-1} className="border-b border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 sm:px-6" role="alert">{error}</p> : null}
    {notice ? <p ref={reversalResult} tabIndex={-1} className="border-b border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-6" role="status" aria-live="polite">{notice}</p> : null}

    {confirmation && confirmation.contextKey === contextKey && confirmation.targetKey === targetKey ? <div
      className="space-y-3 border-b border-amber-200 bg-amber-50 px-5 py-5 dark:border-amber-900 dark:bg-amber-950/20 sm:px-6"
      aria-labelledby="workforce-calendar-reversal-title"
    >
      <h3 ref={confirmationTitle} tabIndex={-1} id="workforce-calendar-reversal-title" className="font-semibold">{t("reversalReviewTitle")}</h3>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{confirmation.label} · {confirmation.scopeLabel}</p>
      <p className="text-sm">{t("reversalDates", {
        source: dateFormatter.format(new Date(`${confirmation.draft.sourceDate}T00:00:00.000Z`)),
        destination: dateFormatter.format(new Date(`${confirmation.draft.destinationDate}T00:00:00.000Z`)),
      })}</p>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("reversalReviewHint")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => void reverseMovedDay()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
          {t("reversalConfirm")}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={cancelReversal}>{t("reversalCancel")}</Button>
      </div>
    </div> : null}

    <div className="grid gap-5 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6 lg:grid-cols-2">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-scope">{t("scope")}</label>
        <Select
          id="workforce-calendar-scope"
          className="min-h-11"
          value={scope}
          disabled={saving || Boolean(confirmation)}
          onChange={(event) => {
            const nextScope = event.target.value as WorkforceCalendarConfigurationScope
            setScope(nextScope)
            setTeamId("")
            setTeamQuery("")
            setAgentId("")
            setAgentQuery("")
            if (nextScope === "AGENT") setOperation("CREATE_OVERRIDE")
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
          disabled={saving || Boolean(confirmation)}
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
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => setTeamQuery(event.target.value)}
            maxLength={100}
            placeholder={t("teamSearchPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:shrink-0"
            onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
            disabled={loading || saving || Boolean(confirmation)}
          >
            <Search aria-hidden="true" />
            {t("searchTeams")}
          </Button>
        </div>
        {contextCalendar?.teamDirectory.hasMore ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("teamSearchNarrower")}</p> : null}
        {!loading && calendar && calendar.teamDirectory.items.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">{t("noTeams")}</p> : null}
      </div> : null}

      {scope === "AGENT" ? <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workforce-calendar-agent">{t("agent")}</label>
        <Select
          id="workforce-calendar-agent"
          className="min-h-11"
          value={agentId}
          disabled={saving || Boolean(confirmation)}
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
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => setAgentQuery(event.target.value)}
            maxLength={100}
            placeholder={t("agentSearchPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:shrink-0"
            onClick={() => void load({ scope, teamId, teamQuery, agentId, agentQuery })}
            disabled={loading || saving || Boolean(confirmation)}
          >
            <Search aria-hidden="true" />
            {t("searchAgents")}
          </Button>
        </div>
        {contextCalendar?.agentDirectory.hasMore ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("agentSearchNarrower")}</p> : null}
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
      <form className="grid grid-cols-1 gap-5 px-5 py-6 sm:px-6 md:grid-cols-4" onSubmit={createOverride}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-operation">{t("operation")}</label>
          <Select
            id="workforce-calendar-operation"
            className="min-h-11"
            value={operation}
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => {
              setOperation(event.target.value as CalendarEditorOperation)
              setNotice(null)
            }}
          >
            <option value="CREATE_OVERRIDE">{t("operations.CREATE_OVERRIDE")}</option>
            {scope !== "AGENT" ? <option value="MOVE_WORKDAY">{t("operations.MOVE_WORKDAY")}</option> : null}
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-date">{
            t(operation === "MOVE_WORKDAY" ? "moveSourceDate" : "date")
          }</label>
          <Input
            id="workforce-calendar-date"
            type="date"
            className="min-h-11"
            min={minimumDate}
            max={previousDateKey(visibleCalendar.endExclusive)}
            value={date}
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => { setDate(event.target.value); setNotice(null) }}
            aria-describedby={operation === "MOVE_WORKDAY" ? "workforce-calendar-move-source-hint" : undefined}
            required
          />
          {operation === "MOVE_WORKDAY" ? <p
            id="workforce-calendar-move-source-hint"
            className="text-xs leading-5 text-muted-foreground"
          >{t("moveSourceHint")}</p> : null}
        </div>
        {operation === "CREATE_OVERRIDE" ? <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-kind">{t("kind")}</label>
          <Select
            id="workforce-calendar-kind"
            className="min-h-11"
            value={kind}
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => { setKind(event.target.value as WorkforceCalendarCreateKind); setNotice(null) }}
          >
            {WORKFORCE_CALENDAR_EDITOR_KINDS.map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}
          </Select>
        </div> : <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-destination-date">{t("moveDestinationDate")}</label>
          <Input
            id="workforce-calendar-destination-date"
            type="date"
            className="min-h-11"
            min={minimumDate}
            max={previousDateKey(visibleCalendar.endExclusive)}
            value={destinationDate}
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => { setDestinationDate(event.target.value); setNotice(null) }}
            aria-describedby="workforce-calendar-move-destination-hint"
            required
          />
          <p
            id="workforce-calendar-move-destination-hint"
            className="text-xs leading-5 text-muted-foreground"
          >{t("moveDestinationHint")}</p>
        </div>}
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-name">{
            t(operation === "MOVE_WORKDAY" ? "moveName" : scope === "AGENT" ? "agentName" : "name")
          }</label>
          <Input
            id="workforce-calendar-name"
            className="min-h-11"
            value={name}
            disabled={saving || Boolean(confirmation)}
            onChange={(event) => { setName(event.target.value); setNotice(null) }}
            maxLength={160}
            placeholder={t(operation === "MOVE_WORKDAY"
              ? "moveNamePlaceholder"
              : scope === "AGENT" ? "agentNamePlaceholder" : "namePlaceholder")}
            aria-describedby={operation === "MOVE_WORKDAY"
              ? "workforce-calendar-move-name-hint"
              : scope === "AGENT" ? "workforce-calendar-agent-name-hint" : undefined}
            required
          />
          {operation === "MOVE_WORKDAY" ? <p
            id="workforce-calendar-move-name-hint"
            className="text-xs leading-5 text-muted-foreground"
          >{t("moveNameHint")}</p> : scope === "AGENT" ? <p
            id="workforce-calendar-agent-name-hint"
            className="text-xs leading-5 text-muted-foreground"
          >{t("agentNameHint")}</p> : null}
        </div>
        <div className="md:col-span-4">
          <p className="mb-4 text-sm leading-6 text-muted-foreground">{
            operation === "MOVE_WORKDAY"
              ? scope === "TEAM" && selectedTeam
                ? t("moveCreateHintTeam", { timezone: visibleCalendar.timezone, team: selectedTeam.name })
                : t("moveCreateHintOrganization", { timezone: visibleCalendar.timezone })
              : scope === "TEAM" && selectedTeam
                ? t("createHintTeam", { timezone: visibleCalendar.timezone, team: selectedTeam.name })
                : scope === "AGENT" && selectedAgent
                  ? t("createHintAgent", { timezone: visibleCalendar.timezone, agent: selectedAgent.name })
                  : t("createHintOrganization", { timezone: visibleCalendar.timezone })
          }</p>
          <Button type="submit" className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto" disabled={saving || loading || Boolean(confirmation) || !canCreate}>
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
            {t(operation === "MOVE_WORKDAY" ? "moveCreate" : "create")}
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
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">{day.name || t("unnamed")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}</p>
                {day.pairedDate ? <p className="mt-1 text-xs text-muted-foreground">{t("pairedDate", {
                  date: dateFormatter.format(new Date(`${day.pairedDate}T00:00:00.000Z`)),
                })}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="w-fit">{t(`kinds.${day.kind}`)}</Badge>
                {scope !== "AGENT" && day.kind === "MOVED_DAY_OFF" && day.pairedDate && day.pairGenerationId
                  && (scope === "ORGANIZATION" || selectedTeam?.isActive) ? <Button
                    type="button" variant="outline" className="min-h-11"
                    disabled={loading || saving || Boolean(confirmation)}
                    aria-label={t("reversalActionLabel", { name: day.name || t("unnamed") })}
                    onClick={(event) => {
                      if (!day.pairedDate || !day.pairGenerationId) return
                      reversalSource.current = event.currentTarget
                      reversalFocus.current = null
                      setNotice(null)
                      setError(null)
                      setConfirmation({
                        contextKey, targetKey, label: day.name || t("unnamed"),
                        scopeLabel: scope === "TEAM" ? selectedTeam?.name ?? t("scopes.TEAM") : t("scopes.ORGANIZATION"),
                        selection: { scope, teamId, teamQuery, agentId, agentQuery },
                        draft: {
                          operation: "REVERSE_MOVE_WORKDAY", scope,
                          ...(scope === "TEAM" ? { teamId } : {}),
                          sourceDate: day.date, destinationDate: day.pairedDate, pairGenerationId: day.pairGenerationId,
                        },
                      })
                    }}
                  >{t("reversalAction")}</Button> : null}
              </div>
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
