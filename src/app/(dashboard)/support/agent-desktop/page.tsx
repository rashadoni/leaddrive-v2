"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Headphones,
  RefreshCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { HelpButton } from "@/components/help/help-button"
import { formatDateTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"

type QueueTicket = {
  id: string
  ticketNumber: string
  subject: string
  priority: string
  status: string
  createdAt: string
  updatedAt: string
  actionableDueAt: string | null
  isOverdue: boolean
}

type AgentDesktopData = {
  generatedAt: string
  scope: "assigned_to_current_user"
  period: {
    key: "rolling_30_days"
    days: number
    from: string
    to: string
  }
  queue: {
    total: number
    shown: number
    nextTicket: QueueTicket | null
    tickets: QueueTicket[]
    byPriority: Record<string, number>
  }
  metrics: {
    averageFirstResponseSeconds: number | null
    firstResponseSample: number
    averageResolutionSeconds: number | null
    resolutionSample: number
    resolutionRatePct: number | null
    resolutionRateSample: number
    slaCompliancePct: number | null
    slaObligationSample: number
    csatAverage: number | null
    csatSample: number
  }
  canViewTeamAnalytics: boolean
}

type LoadError = "forbidden" | "failed" | null

function responseError(response: Response): LoadError {
  return response.status === 403 ? "forbidden" : "failed"
}

export default function AgentDesktopPage() {
  const t = useTranslations("agentDesktop")
  const locale = useLocale()
  const { data: session, status: sessionStatus } = useSession()
  const sessionUserId = session?.user?.id
  const organizationId = session?.user?.organizationId
  const displayName = session?.user?.name || t("agentFallback")

  const [data, setData] = useState<AgentDesktopData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError>(null)
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [availabilitySaved, setAvailabilitySaved] = useState(false)
  const [availabilityRetry, setAvailabilityRetry] = useState<"load" | boolean | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!sessionUserId) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch("/api/v1/support/agent-desktop", {
        headers: organizationId ? { "x-organization-id": String(organizationId) } : undefined,
      })
      if (!response.ok) {
        setLoadError(responseError(response))
        return
      }
      const payload = await response.json()
      if (!payload.success || !payload.data) {
        setLoadError("failed")
        return
      }
      setData(payload.data)
    } catch {
      setLoadError("failed")
    } finally {
      setLoading(false)
    }
  }, [organizationId, sessionUserId])

  const loadAvailability = useCallback(async () => {
    if (!sessionUserId) return
    setAvailabilityLoading(true)
    setAvailabilitySaved(false)
    setAvailabilityRetry(null)
    try {
      const response = await fetch("/api/v1/users/me/availability", {
        headers: organizationId ? { "x-organization-id": String(organizationId) } : undefined,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || typeof payload.data?.isAvailable !== "boolean") {
        setAvailabilityRetry("load")
        return
      }
      setIsAvailable(payload.data.isAvailable)
    } catch {
      setAvailabilityRetry("load")
    } finally {
      setAvailabilityLoading(false)
    }
  }, [organizationId, sessionUserId])

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !sessionUserId) return
    void loadDashboard()
    void loadAvailability()
  }, [loadAvailability, loadDashboard, sessionStatus, sessionUserId])

  const saveAvailability = async (nextValue: boolean) => {
    if (availabilitySaving || availabilityLoading) return
    setAvailabilitySaving(true)
    setAvailabilitySaved(false)
    setAvailabilityRetry(null)
    try {
      const response = await fetch("/api/v1/users/me/availability", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(organizationId ? { "x-organization-id": String(organizationId) } : {}),
        },
        body: JSON.stringify({ isAvailable: nextValue }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || payload.data?.isAvailable !== nextValue) {
        setAvailabilityRetry(nextValue)
        toast.error(t("availabilitySaveFailed"))
        return
      }
      setIsAvailable(nextValue)
      setAvailabilitySaved(true)
      toast.success(t("availabilitySaved"))
    } catch {
      setAvailabilityRetry(nextValue)
      toast.error(t("availabilitySaveFailed"))
    } finally {
      setAvailabilitySaving(false)
    }
  }

  const formatDuration = (seconds: number | null) => {
    if (seconds == null) return t("unavailableMetric")
    if (seconds < 60) return t("durationSeconds", { count: seconds })
    const totalMinutes = Math.round(seconds / 60)
    if (totalMinutes < 60) return t("durationMinutes", { count: totalMinutes })
    return t("durationHoursMinutes", {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    })
  }

  const priorityLabel = (priority: string) => {
    const key = ["critical", "urgent", "high", "medium", "low"].includes(priority) ? priority : "unknown"
    return t(`priority.${key}`)
  }

  const statusLabel = (status: string) => {
    const key = ["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"].includes(status)
      ? status
      : "unknown"
    return t(`status.${key}`)
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div data-testid="agent-desktop-permission" className="mx-auto flex min-h-[50vh] max-w-xl items-center px-4 py-8">
        <div className="w-full rounded-lg border bg-card p-5 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-base font-semibold">{t("permissionTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("signInDescription")}</p>
        </div>
      </div>
    )
  }

  if (sessionStatus === "loading" || (loading && !data)) {
    return <AgentDesktopSkeleton label={t("loading")} />
  }

  if (loadError && !data) {
    return (
      <div data-testid="agent-desktop-load-error" className="mx-auto flex min-h-[50vh] max-w-xl items-center px-4 py-8">
        <div className="w-full rounded-lg border bg-card p-5 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-base font-semibold">
            {loadError === "forbidden" ? t("permissionTitle") : t("loadFailedTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError === "forbidden" ? t("permissionDescription") : t("loadFailedDescription")}
          </p>
          {loadError !== "forbidden" && (
            <Button data-testid="agent-desktop-retry-load" className="mt-4 min-h-11" onClick={() => void loadDashboard()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (!data) return null

  const nextTicket = data.queue.nextTicket
  const metrics = [
    {
      key: "response",
      label: t("avgResponse"),
      value: formatDuration(data.metrics.averageFirstResponseSeconds),
      sample: data.metrics.firstResponseSample,
      hint: t("avgResponseHint"),
    },
    {
      key: "resolution",
      label: t("avgResolution"),
      value: formatDuration(data.metrics.averageResolutionSeconds),
      sample: data.metrics.resolutionSample,
      hint: t("avgResolutionHint"),
    },
    {
      key: "rate",
      label: t("resolutionRate"),
      value: data.metrics.resolutionRatePct == null
        ? t("unavailableMetric")
        : `${data.metrics.resolutionRatePct}%`,
      sample: data.metrics.resolutionRateSample,
      hint: t("resolutionRateHint"),
    },
    {
      key: "sla",
      label: t("slaCompliance"),
      value: data.metrics.slaCompliancePct == null
        ? t("unavailableMetric")
        : `${data.metrics.slaCompliancePct}%`,
      sample: data.metrics.slaObligationSample,
      hint: t("slaComplianceHint"),
    },
    {
      key: "csat",
      label: t("csat"),
      value: data.metrics.csatAverage == null
        ? t("unavailableMetric")
        : t("csatValue", { value: data.metrics.csatAverage }),
      sample: data.metrics.csatSample,
      hint: t("csatHint"),
    },
  ]

  return (
    <div data-testid="agent-desktop-workspace" className="mx-auto max-w-[1120px] space-y-4 pb-8">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Headphones className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="truncate text-xl font-semibold tracking-tight">{t("title")}</h1>
            <HelpButton slug="agent-desktop" variant="label" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { name: displayName })}</p>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2 sm:max-w-[360px]">
          <div className="flex min-h-11 items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {isAvailable == null
                  ? availabilityLoading ? t("availabilityLoading") : t("availabilityUnknown")
                  : isAvailable ? t("available") : t("unavailable")}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {isAvailable == null
                  ? t("availabilityUnknownHint")
                  : isAvailable ? t("availableHint") : t("unavailableHint")}
              </p>
            </div>
            <div className="flex min-h-11 min-w-11 items-center justify-center">
              <Switch
                data-testid="agent-desktop-availability"
                checked={isAvailable ?? false}
                disabled={isAvailable == null || availabilityLoading || availabilitySaving}
                onCheckedChange={(checked) => void saveAvailability(checked)}
                aria-label={t("availabilityLabel")}
                aria-describedby="availability-status"
                className="h-6 w-11 [&>span]:h-5 [&>span]:w-5 data-[state=checked]:[&>span]:translate-x-5 motion-reduce:transition-none motion-reduce:[&>span]:transition-none"
              />
            </div>
          </div>
          <div id="availability-status" className="text-xs" aria-live="polite">
            {availabilitySaving && <span className="text-muted-foreground">{t("availabilitySaving")}</span>}
            {availabilitySaved && !availabilitySaving && availabilityRetry == null && (
              <span data-testid="agent-desktop-availability-saved" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />{t("availabilitySaved")}
              </span>
            )}
            {availabilityRetry != null && !availabilitySaving && (
              <span data-testid="agent-desktop-availability-error" className="flex flex-wrap items-center gap-x-2 font-medium text-red-700 dark:text-red-300">
                {availabilityRetry === "load" ? t("availabilityLoadFailed") : t("availabilityUnchanged")}
                <button
                  type="button"
                  data-testid="agent-desktop-retry-availability"
                  className="min-h-11 rounded px-2 font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => availabilityRetry === "load"
                    ? void loadAvailability()
                    : void saveAvailability(availabilityRetry)}
                >
                  {t("retry")}
                </button>
              </span>
            )}
          </div>
        </div>
      </header>

      {loadError && (
        <div data-testid="agent-desktop-refresh-error" role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span>{t("refreshFailed")}</span>
          <Button data-testid="agent-desktop-retry-refresh" variant="outline" size="sm" className="min-h-11" onClick={() => void loadDashboard()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("retry")}
          </Button>
        </div>
      )}

      <section data-testid="agent-desktop-next-case" aria-labelledby="next-ticket-heading" className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("nextAction")}
            </p>
            {nextTicket ? (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 id="next-ticket-heading" className="truncate text-base font-semibold">
                    {nextTicket.subject}
                  </h2>
                  {nextTicket.isOverdue && <Badge variant="destructive">{t("overdue")}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {nextTicket.ticketNumber} · {priorityLabel(nextTicket.priority)} · {statusLabel(nextTicket.status)}
                  {nextTicket.actionableDueAt
                    ? ` · ${t("due", { date: formatDateTime(nextTicket.actionableDueAt, locale) })}`
                    : ""}
                </p>
              </>
            ) : (
              <>
                <h2 id="next-ticket-heading" className="mt-1 text-base font-semibold">{t("queueClearTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("queueClearDescription")}</p>
              </>
            )}
          </div>
          {nextTicket && (
            <Button
              asChild
              className="min-h-11 shrink-0 bg-foreground text-background hover:bg-foreground/90"
            >
              <Link href={`/tickets/${nextTicket.id}`}>
                {t("openNext")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="queue-heading" className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 id="queue-heading" className="text-sm font-semibold">{t("personalQueue")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("queueCount", { shown: data.queue.shown, total: data.queue.total })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              data-testid="agent-desktop-refresh"
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              disabled={loading}
              onClick={() => void loadDashboard()}
              aria-label={t("refresh")}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
            <Button asChild variant="ghost" size="sm" className="min-h-11">
              <Link href="/tickets?assignee=me">
                {t("viewAll")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        {data.queue.tickets.length === 0 ? (
          <div data-testid="agent-desktop-empty-queue" className="px-4 py-8 text-center">
            <Check className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">{t("noOpenCases")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("noOpenCasesHint")}</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t("colSubject")}</th>
                    <th className="px-3 py-2 font-medium">{t("colPriority")}</th>
                    <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
                    <th className="px-3 py-2 font-medium">{t("colDue")}</th>
                    <th className="w-16 px-3 py-2"><span className="sr-only">{t("openTicket")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.queue.tickets.map((ticket) => (
                    <tr key={ticket.id} className="border-t transition-colors hover:bg-muted/40 motion-reduce:transition-none">
                      <td className="max-w-[420px] px-4 py-2.5">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="block min-h-11 rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate font-medium">{ticket.subject}</span>
                          <span className="block text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">{priorityLabel(ticket.priority)}</td>
                      <td className="px-3 py-2.5"><Badge variant="outline">{statusLabel(ticket.status)}</Badge></td>
                      <td className={cn("whitespace-nowrap px-3 py-2.5 text-xs", ticket.isOverdue ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>
                        {ticket.actionableDueAt ? formatDateTime(ticket.actionableDueAt, locale) : t("noDueDate")}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11">
                          <Link href={`/tickets/${ticket.id}`} aria-label={t("openTicketNamed", { subject: ticket.subject })}>
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden">
              {data.queue.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{ticket.subject}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {ticket.ticketNumber} · {priorityLabel(ticket.priority)} · {statusLabel(ticket.status)}
                      </span>
                      {ticket.actionableDueAt && (
                        <span className={cn("mt-1 block text-xs", ticket.isOverdue ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>
                          {t("due", { date: formatDateTime(ticket.actionableDueAt, locale) })}
                        </span>
                      )}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="metrics-heading" className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 id="metrics-heading" className="text-sm font-semibold">{t("myPerformance")}</h2>
            <p className="text-xs text-muted-foreground">{t("rollingPeriod", { days: data.period.days })}</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("updatedAt", { date: formatDateTime(data.generatedAt, locale) })}
          </span>
        </div>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map((metric, index) => (
            <div
              key={metric.key}
              className={cn(
                "px-4 py-3",
                index > 0 && "border-t sm:border-t-0 sm:border-l",
                index > 1 && index % 2 === 0 && "sm:border-l-0 lg:border-l",
              )}
            >
              <dt className="text-xs font-medium text-muted-foreground">{metric.label}</dt>
              <dd className="mt-1">
                <span className="block text-lg font-semibold tabular-nums">{metric.value}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("sampleSize", { count: metric.sample })}</span>
                <span className="sr-only">{metric.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
        <details className="border-t px-4 py-3 text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("howMetricsWork")}
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {metrics.map((metric) => <li key={metric.key}>{metric.hint}</li>)}
          </ul>
        </details>
      </section>

      {data.canViewTeamAnalytics && (
        <aside className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-medium">{t("teamAnalytics")}</h2>
              <p className="text-xs text-muted-foreground">{t("teamAnalyticsHint")}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0">
            <Link href="/leaderboard?group=tickets">{t("openTeamAnalytics")}</Link>
          </Button>
        </aside>
      )}
    </div>
  )
}

function AgentDesktopSkeleton({ label }: { label: string }) {
  return (
    <div data-testid="agent-desktop-loading" className="mx-auto max-w-[1120px] space-y-4" aria-busy="true" aria-label={label}>
      <div className="flex items-center justify-between border-b pb-4">
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-4 w-64 max-w-[70vw] animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
        <Clock3 className="h-5 w-5 animate-pulse text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
      </div>
      {[96, 260, 148].map((height) => (
        <div key={height} className="animate-pulse rounded-lg border bg-muted/30 motion-reduce:animate-none" style={{ height }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}
