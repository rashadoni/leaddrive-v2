"use client"

import type { FormEvent, ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  CalendarRange,
  FileWarning,
  Loader2,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  parseWorkforceEvidenceTargets,
  parseWorkforceEvidenceTimeline,
  workforceEvidenceReasonLabelKeys,
  type WorkforceEvidenceTarget,
  type WorkforceEvidenceTimelineView,
  type WorkforceEvidenceVerdict,
} from "@/lib/workforce/evidence-timeline-client"
import {
  WORKFORCE_EVIDENCE_ACCESS_PURPOSES,
  WORKFORCE_EVIDENCE_ACCESS_REASONS,
  type WorkforceEvidenceAccessPurpose,
  type WorkforceEvidenceAccessReason,
} from "@/lib/workforce/evidence-timeline"

type FailureKind = "accessDenied" | "rateLimited" | "tooLarge" | "unavailable" | "invalidResponse" | "requestFailed"

type ApiEnvelope = {
  success?: boolean
  code?: string
  data?: unknown
}

const CASE_REFERENCE = /^[A-Za-z0-9._:/-]{1,100}$/

function validRange(start: string, end: string): boolean {
  const startTime = Date.parse(`${start}T00:00:00.000Z`)
  const endTime = Date.parse(`${end}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)
    && Number.isFinite(startTime) && Number.isFinite(endTime)
    && endTime >= startTime && endTime - startTime <= 30 * 86_400_000
}

function failureKind(response: Response): FailureKind {
  if (response.status === 403) return "accessDenied"
  if (response.status === 413) return "tooLarge"
  if (response.status === 429) return "rateLimited"
  if (response.status === 503) return "unavailable"
  return "requestFailed"
}

function verdictVariant(verdict: WorkforceEvidenceVerdict): "success" | "warning" | "outline" {
  if (verdict === "INSIDE" || verdict === "ELIGIBLE" || verdict === "SATISFIED") return "success"
  if (verdict === "OUTSIDE" || verdict === "REVIEW_REQUIRED") return "warning"
  return "outline"
}

export function WorkforceEvidenceTimeline() {
  const { data: session } = useSession()
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const principalUserId = session?.user?.id ? String(session.user.id) : ""
  if (!organizationId || !principalUserId) return null

  // The key is a hard privacy fence: switching tenant or human principal
  // unmounts the entire sensitive scope, aborts both reads and recreates every
  // form/result state before the new session can interact with the page.
  const sessionScopeKey = JSON.stringify([organizationId, principalUserId])
  return <WorkforceEvidenceTimelineScope key={sessionScopeKey} organizationId={organizationId} />
}

function WorkforceEvidenceTimelineScope({ organizationId }: { organizationId: string }) {
  const t = useTranslations("workforceEvidenceTimeline")
  const locale = useLocale()

  const [purpose, setPurpose] = useState<WorkforceEvidenceAccessPurpose | "">("")
  const [reasonCode, setReasonCode] = useState<WorkforceEvidenceAccessReason | "">("")
  const [caseReference, setCaseReference] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [query, setQuery] = useState("")
  const [targets, setTargets] = useState<WorkforceEvidenceTarget[]>([])
  const [selectedTarget, setSelectedTarget] = useState<WorkforceEvidenceTarget | null>(null)
  const [hasMoreTargets, setHasMoreTargets] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<FailureKind | "contextRequired" | "searchMinimum" | "noResults" | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<FailureKind | "contextRequired" | "rangeInvalid" | "caseInvalid" | "employeeRequired" | null>(null)
  const [timeline, setTimeline] = useState<WorkforceEvidenceTimelineView | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const timelineController = useRef<AbortController | null>(null)
  const employeeSearchInput = useRef<HTMLInputElement | null>(null)
  const changeEmployeeButton = useRef<HTMLButtonElement | null>(null)
  const pendingEmployeeFocus = useRef<"selected" | "search" | null>(null)

  useEffect(() => () => {
    searchController.current?.abort()
    timelineController.current?.abort()
    searchController.current = null
    timelineController.current = null
  }, [])

  useEffect(() => {
    if (pendingEmployeeFocus.current === "selected" && selectedTarget) {
      changeEmployeeButton.current?.focus()
      pendingEmployeeFocus.current = null
    } else if (pendingEmployeeFocus.current === "search" && !selectedTarget) {
      employeeSearchInput.current?.focus()
      pendingEmployeeFocus.current = null
    }
  }, [selectedTarget])

  function headers() {
    return {
      ...(organizationId ? { "x-organization-id": organizationId } : {}),
      "x-workforce-access-purpose": purpose,
      "x-workforce-access-reason-code": reasonCode,
      ...(caseReference.trim() ? { "x-workforce-case-reference": caseReference.trim() } : {}),
    }
  }

  function invalidateTimeline() {
    timelineController.current?.abort()
    setLoading(false)
    setTimeline(null)
    setError(null)
  }

  function changeAccess(next: {
    purpose?: WorkforceEvidenceAccessPurpose | ""
    reasonCode?: WorkforceEvidenceAccessReason | ""
    caseReference?: string
  }) {
    searchController.current?.abort()
    setTargets([])
    setHasMoreTargets(false)
    setSearchError(null)
    setSelectedTarget(null)
    setQuery("")
    if (next.purpose !== undefined) setPurpose(next.purpose)
    if (next.reasonCode !== undefined) setReasonCode(next.reasonCode)
    if (next.caseReference !== undefined) setCaseReference(next.caseReference)
    invalidateTimeline()
  }

  async function searchEmployees() {
    if (!purpose || !reasonCode) {
      setSearchError("contextRequired")
      setTargets([])
      return
    }
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 2 || normalizedQuery.length > 80) {
      setSearchError("searchMinimum")
      setTargets([])
      return
    }
    if (caseReference.trim() && !CASE_REFERENCE.test(caseReference.trim())) {
      setSearchError(null)
      setError("caseInvalid")
      return
    }
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearching(true)
    setSearchError(null)
    setTargets([])
    setHasMoreTargets(false)
    try {
      const response = await fetch(`/api/v1/workforce/evidence/targets?q=${encodeURIComponent(normalizedQuery)}`, {
        cache: "no-store",
        headers: headers(),
        signal: controller.signal,
      })
      const envelope = await response.json().catch(() => ({})) as ApiEnvelope
      if (controller.signal.aborted || searchController.current !== controller) return
      if (!response.ok) {
        setSearchError(failureKind(response))
        return
      }
      const parsed = envelope.success === true ? parseWorkforceEvidenceTargets(envelope.data) : null
      if (!parsed) {
        setSearchError("invalidResponse")
        return
      }
      setTargets(parsed.items)
      setHasMoreTargets(parsed.hasMore)
      setSearchError(parsed.items.length === 0 ? "noResults" : null)
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setSearchError("requestFailed")
    } finally {
      if (searchController.current === controller) setSearching(false)
    }
  }

  async function loadTimeline(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!purpose || !reasonCode) {
      setError("contextRequired")
      return
    }
    if (!selectedTarget) {
      setError("employeeRequired")
      return
    }
    if (!validRange(start, end)) {
      setError("rangeInvalid")
      return
    }
    const normalizedCaseReference = caseReference.trim()
    if (normalizedCaseReference && !CASE_REFERENCE.test(normalizedCaseReference)) {
      setError("caseInvalid")
      return
    }
    timelineController.current?.abort()
    const controller = new AbortController()
    timelineController.current = controller
    setLoading(true)
    setError(null)
    setTimeline(null)
    try {
      const params = new URLSearchParams({ agentId: selectedTarget.id, start, end })
      const response = await fetch(`/api/v1/workforce/evidence/timeline?${params}`, {
        cache: "no-store",
        headers: headers(),
        signal: controller.signal,
      })
      const envelope = await response.json().catch(() => ({})) as ApiEnvelope
      if (controller.signal.aborted || timelineController.current !== controller) return
      if (!response.ok) {
        setError(failureKind(response))
        return
      }
      const parsed = envelope.success === true
        ? parseWorkforceEvidenceTimeline(envelope.data, selectedTarget.id)
        : null
      if (!parsed || parsed.start !== start || parsed.end !== end
        || parsed.access.purpose !== purpose || parsed.access.reasonCode !== reasonCode
        || parsed.access.caseReference !== (normalizedCaseReference || null)) {
        setError("invalidResponse")
        return
      }
      setTimeline(parsed)
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setError("requestFailed")
    } finally {
      if (timelineController.current === controller) setLoading(false)
    }
  }

  const dateTime = useMemo(() => timeline
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timeline.timezone,
      })
    : null, [locale, timeline])

  return <section className="space-y-7">
    <PageDescription title={t("title")} description={t("subtitle")} />

    <section aria-labelledby="workforce-evidence-boundary" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 sm:px-6">
      <div className="flex gap-3">
        <FileWarning className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <div>
          <h2 id="workforce-evidence-boundary" className="font-semibold">{t("boundaryTitle")}</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{t("boundary")}</p>
        </div>
      </div>
    </section>

    <form className="overflow-hidden rounded-xl border border-zinc-200 bg-background dark:border-zinc-800" onSubmit={loadTimeline}>
      <div className="border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6">
        <div className="flex max-w-3xl gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 className="font-semibold">{t("reviewContextTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("reviewContextHint")}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-5 py-6 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <SelectField id="evidence-purpose" label={t("purpose")} value={purpose} onChange={(value) => changeAccess({ purpose: value as WorkforceEvidenceAccessPurpose })}>
            <option value="" disabled>{t("selectPurpose")}</option>
            {WORKFORCE_EVIDENCE_ACCESS_PURPOSES.map((value) => <option key={value} value={value}>{t(`purposes.${value}`)}</option>)}
          </SelectField>
          <SelectField id="evidence-reason" label={t("reason")} value={reasonCode} onChange={(value) => changeAccess({ reasonCode: value as WorkforceEvidenceAccessReason })}>
            <option value="" disabled>{t("selectReason")}</option>
            {WORKFORCE_EVIDENCE_ACCESS_REASONS.map((value) => <option key={value} value={value}>{t(`reasons.${value}`)}</option>)}
          </SelectField>
          <div className="space-y-1.5">
            <label htmlFor="evidence-case-reference" className="text-sm font-medium">{t("caseReference")}</label>
            <Input id="evidence-case-reference" value={caseReference} maxLength={100} pattern="[A-Za-z0-9._:/-]{1,100}" placeholder={t("caseReferencePlaceholder")} onChange={(event) => changeAccess({ caseReference: event.target.value })} className="min-h-12" />
            <p className="text-xs leading-5 text-muted-foreground">{t("caseReferenceHint")}</p>
          </div>
        </div>

        <div className="space-y-3">
          <p id="evidence-employee-label" className="text-sm font-medium">{t("employee")}</p>
          {selectedTarget ? <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-2 dark:border-zinc-700">
            <span className="flex min-w-0 flex-1 items-center gap-2 break-words text-sm font-medium [overflow-wrap:anywhere]"><UserRoundCheck className="size-4 shrink-0 text-orange-600" aria-hidden="true" />{selectedTarget.label}</span>
            <Button ref={changeEmployeeButton} type="button" variant="ghost" className="min-h-11" onClick={() => { pendingEmployeeFocus.current = "search"; setSelectedTarget(null); setTargets([]); invalidateTimeline() }}>{t("changeEmployee")}</Button>
          </div> : <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input ref={employeeSearchInput} id="evidence-employee-search" aria-labelledby="evidence-employee-label" value={query} maxLength={80} autoComplete="off" placeholder={t("employeeSearchPlaceholder")} onChange={(event) => { searchController.current?.abort(); setSearching(false); setTargets([]); setHasMoreTargets(false); setQuery(event.target.value); setSearchError(null) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchEmployees() } }} className="min-h-12" />
              <Button type="button" variant="outline" className="min-h-12 shrink-0" disabled={searching || !purpose || !reasonCode} onClick={() => void searchEmployees()}>{searching ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Search />}{t("searchEmployees")}</Button>
            </div>
            {searchError ? <p role="alert" className="text-sm leading-6 text-destructive">{t(searchError)}</p> : null}
            {hasMoreTargets ? <p className="text-sm leading-6 text-muted-foreground">{t("narrowSearch")}</p> : null}
            {targets.length > 0 ? <ul aria-label={t("employeeResults")} className="grid gap-2 sm:grid-cols-2">
              {targets.map((target) => <li key={target.id} className="min-w-0"><Button type="button" variant="outline" className="min-h-12 w-full min-w-0 justify-start whitespace-normal px-4 text-left" onClick={() => { pendingEmployeeFocus.current = "selected"; setSelectedTarget(target); setTargets([]); setHasMoreTargets(false); invalidateTimeline() }}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{target.label}</span></Button></li>)}
            </ul> : null}
          </>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <DateField id="evidence-start" label={t("start")} value={start} onChange={(value) => { setStart(value); invalidateTimeline() }} />
          <DateField id="evidence-end" label={t("end")} value={end} onChange={(value) => { setEnd(value); invalidateTimeline() }} />
          <Button type="submit" className="min-h-12" disabled={loading || !selectedTarget || !purpose || !reasonCode}>{loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CalendarRange />}{t("loadTimeline")}</Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("rangeHint")}</p>
      </div>
    </form>

    {error ? <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive"><p className="leading-6">{t(error)}</p>{selectedTarget && error !== "contextRequired" && error !== "rangeInvalid" && error !== "caseInvalid" && error !== "employeeRequired" ? <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => void loadTimeline()}>{t("retry")}</Button> : null}</div> : null}
    {loading ? <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-5 animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{timeline && !loading ? t("loadedAnnouncement", { employee: timeline.employeeName, count: timeline.evidence.length }) : ""}</p>
    {timeline && dateTime && !loading ? <TimelineResult timeline={timeline} dateTime={dateTime} t={t} /> : null}
  </section>
}

function SelectField(props: { id: string; label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <div className="space-y-1.5"><label htmlFor={props.id} className="text-sm font-medium">{props.label}</label><select id={props.id} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="flex min-h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1">{props.children}</select></div>
}

function DateField(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><label htmlFor={props.id} className="text-sm font-medium">{props.label}</label><Input id={props.id} type="date" required value={props.value} onChange={(event) => props.onChange(event.target.value)} className="min-h-12" /></div>
}

function TimelineResult({ timeline, dateTime, t }: {
  timeline: WorkforceEvidenceTimelineView
  dateTime: Intl.DateTimeFormat
  t: ReturnType<typeof useTranslations>
}) {
  return <section aria-labelledby="evidence-result-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div>
        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">{t("derivedOnly")}</p>
        <h2 id="evidence-result-title" className="mt-1 break-words text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{timeline.employeeName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("resultMeta", { start: timeline.start, end: timeline.end, timezone: timeline.timezone })}</p>
      </div>
      <Badge variant="outline">{t("recordCount", { count: timeline.evidence.length })}</Badge>
    </div>

    {timeline.evidence.length === 0 ? <div className="rounded-xl border border-dashed border-zinc-300 px-5 py-12 text-center dark:border-zinc-700"><p className="font-medium">{t("emptyTitle")}</p><p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{t("empty")}</p></div> : <ol className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {timeline.evidence.map((item, index) => <li key={`${item.capturedAt}-${index}`} className="grid gap-4 px-5 py-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:px-6">
        <div>
          <time dateTime={item.capturedAt} className="text-sm font-medium tabular-nums">{dateTime.format(new Date(item.capturedAt))}</time>
          <p className="mt-1 text-xs text-muted-foreground">{t(`sources.${item.source}`)}</p>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.subject.action ? t(`actions.${item.subject.action}`) : t("subjectUnavailable")}</span>
            <Badge variant={item.subject.reviewState === "PENDING_REVIEW" ? "warning" : "outline"}>{t(`reviewStates.${item.subject.reviewState}`)}</Badge>
            <Badge variant="outline">{t(`retention.${item.rawRetentionState}`)}</Badge>
          </div>
          {item.subject.claimedAt ? <p className="text-sm text-muted-foreground">{t("claimedAt", { date: dateTime.format(new Date(item.subject.claimedAt)) })}</p> : null}
          {item.assessments.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noAssessments")}</p> : <ul className="space-y-2">
            {item.assessments.map((assessment, assessmentIndex) => <li key={`${assessment.assessedAt}-${assessmentIndex}`} className="rounded-lg bg-zinc-50 px-3 py-3 dark:bg-zinc-900/60">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{t(`assessmentKinds.${assessment.kind}`)}</span><Badge variant={verdictVariant(assessment.verdict)}>{t(`verdicts.${assessment.verdict}`)}</Badge></div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{workforceEvidenceReasonLabelKeys(assessment.reasonCodes).map((reason) => t(`reasonLabels.${reason}`)).join(" · ")}</p>
            </li>)}
          </ul>}
        </div>
      </li>)}
    </ol>}
  </section>
}
