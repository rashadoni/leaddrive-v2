"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { workforceExceptionQueueLabelKey } from "@/lib/workforce/exception-queue-labels"

const QUEUE_DECISION_CODES = ["ACKNOWLEDGE", "REQUEST_TIME_CORRECTION"] as const

type QueueDecisionCode = typeof QUEUE_DECISION_CODES[number]
const DECISION_REASONS = {
  ACKNOWLEDGE: "MANAGER_ACKNOWLEDGED_FOR_HUMAN_REVIEW",
  REQUEST_TIME_CORRECTION: "MANAGER_REQUESTED_TIME_CORRECTION_FOR_REVIEW",
} satisfies Record<QueueDecisionCode, string>

type QueueAction = { decisionCode: QueueDecisionCode; actionToken: string }
type QueueItem = {
  displayReference: string
  employeeDisplayName: string
  type: string
  triageSeverity: string
  ageSeconds: number
  stage: string
  evidenceState: string
  employeeResponse: string
  nextAction: string
  decisionContext?: {
    correctionState: string
    employeeVisibility: string
    actions: QueueAction[]
  }
}
type SelectedAction = QueueAction & {
  displayReference: string
  organizationId: string
  operationId: string
}
type ActionFeedback = { tone: "success" | "error"; message: string }

function formatAge(ageSeconds: number, formatter: Intl.RelativeTimeFormat): string {
  const seconds = Math.max(0, Math.floor(ageSeconds))
  if (seconds < 60) return formatter.format(0, "second")
  if (seconds < 3_600) return formatter.format(-Math.floor(seconds / 60), "minute")
  if (seconds < 86_400) return formatter.format(-Math.floor(seconds / 3_600), "hour")
  return formatter.format(-Math.floor(seconds / 86_400), "day")
}

function isQueueDecisionCode(value: unknown): value is QueueDecisionCode {
  return typeof value === "string" && (QUEUE_DECISION_CODES as readonly string[]).includes(value)
}

function safeQueueActions(item: QueueItem): QueueAction[] {
  if (!Array.isArray(item.decisionContext?.actions)) return []
  const eligibleActions = item.decisionContext.actions.filter((action) => (
    action != null
    && isQueueDecisionCode(action.decisionCode)
    && typeof action.actionToken === "string"
    && action.actionToken.length > 0
    && action.actionToken.length <= 2_048
  ))
  return eligibleActions.length === 1 ? eligibleActions : []
}

export function WorkforceExceptionQueue() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("workforceExceptionQueue")
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [accessDeniedRequestKey, setAccessDeniedRequestKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [selectedAction, setSelectedAction] = useState<SelectedAction | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const organizationIdRef = useRef(organizationId)
  const operationIdByTokenRef = useRef(new Map<string, string>())
  const selectedActionTokenRef = useRef<string | null>(null)
  const pendingActionRef = useRef<SelectedAction | null>(null)
  const submittingRef = useRef(false)
  const requestKey = `${organizationId}:${retry}`
  const accessDenied = accessDeniedRequestKey === requestKey
  const ageFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" }),
    [locale],
  )

  useEffect(() => {
    organizationIdRef.current = organizationId
    operationIdByTokenRef.current.clear()
    selectedActionTokenRef.current = null
    pendingActionRef.current = null
    submittingRef.current = false
    setSelectedAction(null)
    setFormError(null)
    setActionFeedback(null)
    setSubmitting(false)
    return () => {
      selectedActionTokenRef.current = null
      pendingActionRef.current = null
      submittingRef.current = false
    }
  }, [organizationId])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/workforce/exceptions", {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        // The server is the only authority after the granular-role cutover.
        // A non-admin with an effective TEAM_EXCEPTION_READ grant must be
        // allowed to reach that server check; conversely an old CRM admin
        // must not be presented as authorized after a 403.
        if (response.status === 403) {
          setItems(null)
          setAccessDeniedRequestKey(requestKey)
          return
        }
        if (!response.ok || !body.success || !Array.isArray(body.data?.cases)) {
          throw new Error("WORKFORCE_EXCEPTION_QUEUE_LOAD_FAILED")
        }
        setItems(body.data.cases)
        setAccessDeniedRequestKey(null)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setItems(null)
          setError(t("loadFailed"))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [organizationId, requestKey, t])

  function closeAction(force = false) {
    if (submittingRef.current && !force) return
    selectedActionTokenRef.current = null
    setSelectedAction(null)
    setFormError(null)
  }

  function refreshQueue(options: { preserveFeedback?: boolean; afterAction?: boolean } = {}) {
    if (submittingRef.current && !options.afterAction) return
    operationIdByTokenRef.current.clear()
    closeAction(true)
    setLoading(true)
    setError(null)
    if (!options.preserveFeedback) setActionFeedback(null)
    setRetry((value) => value + 1)
  }

  function openAction(item: QueueItem, action: QueueAction) {
    if (submittingRef.current) return
    const operationId = operationIdByTokenRef.current.get(action.actionToken)
      ?? globalThis.crypto.randomUUID()
    operationIdByTokenRef.current.set(action.actionToken, operationId)
    selectedActionTokenRef.current = action.actionToken
    setSelectedAction({
      ...action,
      displayReference: item.displayReference,
      organizationId,
      operationId,
    })
    setFormError(null)
    setActionFeedback(null)
  }

  async function recordAction() {
    if (!selectedAction || submittingRef.current) return
    const requestAction = selectedAction
    pendingActionRef.current = requestAction
    submittingRef.current = true

    setSubmitting(true)
    setFormError(null)
    const isCurrentRequest = () => (
      pendingActionRef.current === requestAction
      && selectedActionTokenRef.current === requestAction.actionToken
      && organizationIdRef.current === requestAction.organizationId
    )
    try {
      const response = await fetch("/api/v1/workforce/exception-decisions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(requestAction.organizationId ? { "x-organization-id": requestAction.organizationId } : {}),
        },
        body: JSON.stringify({
          actionToken: requestAction.actionToken,
          operationId: requestAction.operationId,
          reason: DECISION_REASONS[requestAction.decisionCode],
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!isCurrentRequest()) return

      if (response.ok
        && body.success === true
        && body.data?.decisionCode === requestAction.decisionCode) {
        const actionLabel = t(`actions.${requestAction.decisionCode}`)
        const displayReference = requestAction.displayReference
        setActionFeedback({
          tone: "success",
          message: t("actionRecorded", { action: actionLabel, reference: displayReference }),
        })
        refreshQueue({ preserveFeedback: true, afterAction: true })
        return
      }
      if (response.status === 403 && body.code === "WORKFORCE_ATTENDANCE_MFA_REQUIRED") {
        setFormError(t("mfaRequired"))
        return
      }
      if (response.status === 404 || response.status === 409 || response.status === 403) {
        setActionFeedback({ tone: "error", message: t("actionStale") })
        refreshQueue({ preserveFeedback: true, afterAction: true })
        return
      }
      if (response.status === 429) {
        setFormError(t("actionRateLimited"))
        return
      }
      setFormError(t("actionFailed"))
    } catch {
      if (!isCurrentRequest()) return
      // Keep both the encrypted action token and operation id stable. An exact
      // retry can then replay safely if the server committed before the
      // connection failed.
      setFormError(t("actionFailed"))
    } finally {
      if (pendingActionRef.current === requestAction) {
        pendingActionRef.current = null
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  if (accessDenied) {
    return (
      <section className="space-y-6">
        <PageDescription title={t("title")} description={t("subtitle")} />
        <div className="rounded-lg border border-zinc-200 p-4 text-sm text-muted-foreground dark:border-zinc-700" role="status">
          {t("adminOnly")}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <PageDescription title={t("title")} description={t("subtitle")} />
      <section
        data-testid="workforce-exception-queue-boundary"
        aria-labelledby="workforce-exception-queue-boundary"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
      >
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="workforce-exception-queue-boundary" className="font-semibold">{t("boundaryTitle")}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("boundaryHint")}</p>
          </div>
        </div>
      </section>
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild type="button" variant="outline" className="min-h-11">
          <Link href="/workforce/exceptions/report">{t("viewAggregateReport")}</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => refreshQueue()}
          disabled={loading || submitting}
        >
          {loading
            ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
            : <RefreshCw className="mr-2 size-4" />}
          {t("refresh")}
        </Button>
      </div>
      {actionFeedback ? (
        <div
          role={actionFeedback.tone === "error" ? "alert" : "status"}
          className={actionFeedback.tone === "error"
            ? "rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            : "rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-200"}
        >
          {actionFeedback.message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {t("loading")}
        </div>
      ) : null}
      {items && !loading ? (
        <section aria-labelledby="workforce-exception-queue-cases" className="rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-700">
            <h2 id="workforce-exception-queue-cases" className="font-semibold">{t("casesTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("casesHint", { count: items.length })}</p>
          </div>
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            tabIndex={0}
            aria-label={t("casesTitle")}
          >
            <table className="min-w-[1320px] text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("case")}</th>
                  <th className="px-4 py-3 font-medium">{t("employee")}</th>
                  <th className="px-4 py-3 font-medium">{t("reviewAction")}</th>
                  <th className="px-4 py-3 font-medium">{t("type")}</th>
                  <th className="px-4 py-3 font-medium">{t("severity")}</th>
                  <th className="px-4 py-3 font-medium">{t("age")}</th>
                  <th className="px-4 py-3 font-medium">{t("stage")}</th>
                  <th className="px-4 py-3 font-medium">{t("evidence")}</th>
                  <th className="px-4 py-3 font-medium">{t("employeeResponse")}</th>
                  <th className="px-4 py-3 font-medium">{t("nextAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {items.map((item, itemIndex) => {
                  const actions = safeQueueActions(item)
                  const actionOpen = actions.some((action) => action.actionToken === selectedAction?.actionToken)
                  return (
                    <Fragment key={`${item.displayReference}:${itemIndex}`}>
                      <tr>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.displayReference}</td>
                        <td className="px-4 py-3 font-medium">{item.employeeDisplayName}</td>
                        <td className="px-4 py-3" data-testid="workforce-exception-actions">
                          {actions.length > 0 ? (
                            <div className="flex max-w-sm flex-wrap gap-2">
                              {actions.map((action) => (
                                <Button
                                  key={action.decisionCode}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="min-h-11 whitespace-normal text-left"
                                  aria-expanded={actionOpen && selectedAction?.decisionCode === action.decisionCode}
                                  aria-controls={`workforce-exception-action-panel-${itemIndex}`}
                                  disabled={submitting}
                                  onClick={() => openAction(item, action)}
                                >
                                  {t(`actions.${action.decisionCode}`)}
                                </Button>
                              ))}
                            </div>
                          ) : <span className="text-muted-foreground">{t("noActionAvailable")}</span>}
                        </td>
                        <td className="px-4 py-3"><Badge variant="outline">{t(workforceExceptionQueueLabelKey("types", item.type))}</Badge></td>
                        <td className="px-4 py-3"><Badge variant={item.triageSeverity === "ATTENTION_REVIEW" ? "secondary" : "outline"}>{t(workforceExceptionQueueLabelKey("severities", item.triageSeverity))}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{formatAge(item.ageSeconds, ageFormatter)}</td>
                        <td className="px-4 py-3">{t(workforceExceptionQueueLabelKey("stages", item.stage))}</td>
                        <td className="px-4 py-3">{t(workforceExceptionQueueLabelKey("evidenceStates", item.evidenceState))}</td>
                        <td className="px-4 py-3">{t(workforceExceptionQueueLabelKey("employeeResponses", item.employeeResponse))}</td>
                        <td className="px-4 py-3">{t(workforceExceptionQueueLabelKey("nextActions", item.nextAction))}</td>
                      </tr>
                      {actionOpen && selectedAction ? (
                        <tr
                          id={`workforce-exception-action-panel-${itemIndex}`}
                          data-testid="workforce-exception-action-panel"
                        >
                          <td colSpan={10} className="bg-muted/30 px-4 py-5">
                            <form
                              className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
                              onSubmit={(event) => {
                                event.preventDefault()
                                void recordAction()
                              }}
                            >
                              <div className="max-w-3xl space-y-3">
                                <div>
                                  <p className="font-medium">
                                    {t("actionFormTitle", {
                                      action: t(`actions.${selectedAction.decisionCode}`),
                                      reference: selectedAction.displayReference,
                                    })}
                                  </p>
                                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                    {t(`actionHints.${selectedAction.decisionCode}`)}
                                  </p>
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">{t("serverChecksHint")}</p>
                                {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
                              </div>
                              <div className="flex flex-wrap gap-2 lg:justify-end">
                                <Button type="button" variant="ghost" className="min-h-11" disabled={submitting} onClick={() => closeAction()}>
                                  {t("cancelAction")}
                                </Button>
                                <Button type="submit" className="min-h-11" disabled={submitting}>
                                  {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
                                  {t("recordAction")}
                                </Button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
                {items.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">{t("empty")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  )
}
