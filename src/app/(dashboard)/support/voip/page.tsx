"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Headphones,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  WifiOff,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HelpButton } from "@/components/help/help-button"
import { CallJournalDetail } from "@/components/voip/call-journal-detail"
import { CallRecordingPlayer } from "@/components/voip/call-recording-player"
import { MissedInboundQueue } from "@/components/voip/missed-inbound-queue"
import { formatDateTime } from "@/lib/format-date"
import { hasModule } from "@/lib/modules"
import { cn } from "@/lib/utils"
import { isAdmin, isManagerOrAbove } from "@/lib/constants"
import { checkPermission, type Role } from "@/lib/permissions"
import { dialFailureDiagnostic, formatDialDiagnostic } from "@/lib/calls/dial-diagnostics"
import { CALL_DISPOSITION_I18N_KEYS, isCallDisposition } from "@/lib/calls/disposition"

type CallLog = {
  id: string
  direction: string
  status: string
  fromNumber: string
  toNumber: string
  contactId: string | null
  contact: { fullName: string; email: string | null } | null
  duration: number | null
  recordingPlaybackUrl: string | null
  disposition: string | null
  provider: string
  providerOutcome?: string | null
  providerDialStatus?: string | null
  providerHangupCause?: string | null
  createdAt: string
}

type CallSummary = {
  total: number
  inbound: number
  outbound: number
  missed: number
  averageDurationSeconds: number | null
  durationSample: number
}

type ConnectionState = "checking" | "connected" | "disconnected" | "configured" | "not_configured" | "error"
type LoadError = "forbidden" | "failed" | null

const STATUS_KEYS: Record<string, string> = {
  initiated: "initiated",
  ringing: "ringing",
  "in-progress": "inProgress",
  completed: "completed",
  "no-answer": "noAnswer",
  busy: "busy",
  failed: "failed",
}

const FAILURE_STATUSES = new Set(["no-answer", "busy", "failed"])

function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—"
  return `${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, "0")}`
}

function CallStatusBadge({ status }: { status: string }) {
  const t = useTranslations("voip")
  const key = STATUS_KEYS[status] || "unknown"
  return (
    <Badge
      variant={FAILURE_STATUSES.has(status) ? "destructive" : "outline"}
      className={cn(
        "whitespace-nowrap text-xs",
        status === "in-progress" && "border-primary/30 bg-primary/5 text-primary",
      )}
    >
      {t(`statusLabels.${key}`)}
    </Badge>
  )
}

export default function VoipCallsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const t = useTranslations("voip")
  const tc = useTranslations("common")
  const locale = useLocale()
  const role = session?.user?.role ?? ""
  const permissionRole = (role || "viewer") as Role
  const capabilityUser = session?.user as { plan?: string; addons?: string[]; modules?: Record<string, boolean> } | undefined
  const canManageConnection = isAdmin(role)
  const canCallBack = checkPermission(permissionRole, "voip", "write")
  const canOpenContacts = checkPermission(permissionRole, "contacts", "read")
  const canViewMissedQueue = role === "superadmin" || Boolean(
    isManagerOrAbove(role)
    && capabilityUser
    && hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "voip")
    && hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "crm")
    && hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "sales"),
  )

  const [calls, setCalls] = useState<CallLog[]>([])
  const [summary, setSummary] = useState<CallSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState<LoadError>(null)
  const [retryVersion, setRetryVersion] = useState(0)
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [directionFilter, setDirectionFilter] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking")
  const lastDataKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1)
      setSearchQuery(searchInput.trim())
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    if (sessionStatus !== "authenticated") return
    const controller = new AbortController()
    const dataKey = `${page}:${directionFilter}:${searchQuery}`
    if (lastDataKeyRef.current !== dataKey) {
      // Never display rows or aggregates from the previous filter/page under
      // newly selected controls. A same-key refresh keeps its stale snapshot
      // and labels a failure explicitly instead.
      setCalls([])
      setSummary(null)
      setTotalPages(1)
    }
    setLoading(true)
    setLoadError(null)

    void (async () => {
      try {
        const params = new URLSearchParams({ page: String(page), limit: "25", period: "30d", summary: "1" })
        if (directionFilter) params.set("direction", directionFilter)
        if (searchQuery) params.set("search", searchQuery)
        const response = await fetch(`/api/v1/calls?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          setLoadError(response.status === 403 ? "forbidden" : "failed")
          return
        }
        const payload = await response.json()
        if (!Array.isArray(payload.data) || !payload.summary || !payload.pagination) {
          setLoadError("failed")
          return
        }
        setCalls(payload.data)
        setSummary(payload.summary)
        setTotalPages(Math.max(1, payload.pagination.pages || 1))
        lastDataKeyRef.current = dataKey
        setHasLoadedOnce(true)
      } catch (error) {
        if ((error as { name?: unknown })?.name !== "AbortError") setLoadError("failed")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [directionFilter, page, retryVersion, searchQuery, sessionStatus])

  const refreshConnection = useCallback(async () => {
    if (sessionStatus !== "authenticated") return
    setConnectionState("checking")
    try {
      const response = await fetch("/api/v1/calls/providers", { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
        setConnectionState("error")
        return
      }
      setConnectionState(payload.data.some((provider: { ready?: unknown }) => provider.ready === true)
        ? "configured"
        : "not_configured")
    } catch {
      setConnectionState("error")
    }
  }, [sessionStatus])

  const testConnection = useCallback(async () => {
    if (sessionStatus !== "authenticated" || !canManageConnection) return
    setConnectionState("checking")
    try {
      const response = await fetch("/api/v1/calls/test", { method: "POST" })
      const payload = await response.json().catch(() => null)
      setConnectionState(response.ok && payload?.success ? "connected" : "disconnected")
    } catch {
      setConnectionState("error")
    }
  }, [canManageConnection, sessionStatus])

  useEffect(() => {
    void refreshConnection()
  }, [refreshConnection])

  const connectionLabel = t(`connectionState.${connectionState}`)
  const hasFilters = Boolean(searchQuery || directionFilter)
  const metricItems = [
    { key: "total", label: t("totalCalls"), value: summary?.total ?? null, icon: Phone },
    { key: "inbound", label: t("inbound"), value: summary?.inbound ?? null, icon: PhoneIncoming },
    { key: "outbound", label: t("outbound"), value: summary?.outbound ?? null, icon: PhoneOutgoing },
    { key: "missed", label: t("missed"), value: summary?.missed ?? null, icon: PhoneMissed },
    {
      key: "duration",
      label: t("avgDuration"),
      value: summary ? durationLabel(summary.averageDurationSeconds) : null,
      icon: Clock3,
      sample: summary?.durationSample,
    },
  ]

  if (sessionStatus === "loading") {
    return <VoipSkeleton label={t("loadingCalls")} />
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div data-testid="voip-permission-state" className="mx-auto flex min-h-[50vh] max-w-xl items-center px-4 py-8">
        <div className="w-full rounded-lg border bg-card p-5 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-base font-semibold">{t("permissionTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("permissionDescription")}</p>
        </div>
      </div>
    )
  }

  if (loading && !hasLoadedOnce) {
    return <VoipSkeleton label={t("loadingCalls")} />
  }

  if (loadError && !summary && calls.length === 0) {
    const forbidden = loadError === "forbidden"
    return (
      <div data-testid="voip-load-error" className="mx-auto flex min-h-[50vh] max-w-xl items-center px-4 py-8">
        <div className="w-full rounded-lg border bg-card p-5 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-base font-semibold">{forbidden ? t("permissionTitle") : t("loadFailedTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {forbidden ? t("permissionDescription") : t("loadFailedDescription")}
          </p>
          {!forbidden && (
            <Button data-testid="voip-retry-load" variant="outline" className="mt-4 min-h-11 motion-reduce:transition-none" onClick={() => setRetryVersion((value) => value + 1)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="voip-workspace"
      data-state={loading && calls.length === 0 ? "loading" : "ready"}
      data-total-calls={summary?.total ?? 0}
      data-total-pages={totalPages}
      data-rendered-calls={calls.length}
      className="mx-auto max-w-[1180px] space-y-3 pb-8 sm:space-y-4"
    >
      <header className="border-b pb-3 sm:pb-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <HelpButton slug="voip" variant="label" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <aside data-testid="voip-connection-state" data-state={connectionState} data-management-mode={canManageConnection ? "admin" : "read-only"} className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between" aria-label={t("connectionStatus")}>
        <div className="flex min-h-11 items-center gap-2" aria-live="polite">
          {connectionState === "checking" ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
          ) : connectionState === "connected" || connectionState === "configured" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <WifiOff className="h-4 w-4 text-destructive" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-medium">{connectionLabel}</p>
            <p className="text-xs text-muted-foreground">
              {canManageConnection ? t("connectionAdminHint") : t("connectionAgentHint")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="voip-retry-connection" variant="outline" size="sm" className="min-h-11 motion-reduce:transition-none" onClick={() => void (canManageConnection ? testConnection() : refreshConnection())} disabled={connectionState === "checking"}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {canManageConnection ? t("testConnection") : t("refreshConnection")}
          </Button>
          {canManageConnection && (
            <Button asChild variant="ghost" size="sm" className="min-h-11">
              <Link href="/settings/voip">
                <Settings className="h-4 w-4" aria-hidden="true" />
                {tc("settings")}
              </Link>
            </Button>
          )}
        </div>
      </aside>

      <section data-testid="voip-summary" aria-labelledby="call-summary-heading" className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <div>
            <h2 id="call-summary-heading" className="text-sm font-semibold">{t("summaryTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("rolling30Days")}</p>
          </div>
          <Button data-testid="voip-refresh-calls" type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={loading} onClick={() => setRetryVersion((value) => value + 1)} aria-label={t("refreshCalls")}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </Button>
        </div>
        <dl className="grid grid-cols-3 sm:grid-cols-5">
          {metricItems.map((item, index) => {
            const Icon = item.icon
            return (
              <div key={item.key} className={cn("px-3 py-2.5 sm:px-4 sm:py-3", index > 0 && "border-l", index >= 3 && "max-sm:border-t", index === 3 && "max-sm:border-l-0")}>
                <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.label}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  <span>{item.value ?? t("metricUnavailable")}</span>
                  {item.sample != null && <span className="block text-xs font-normal text-muted-foreground">{t("durationSample", { count: item.sample })}</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      {canViewMissedQueue && <MissedInboundQueue />}

      <Suspense fallback={null}>
        <CallJournalDetailSlot />
      </Suspense>

      <section data-testid="voip-call-timeline" aria-labelledby="call-timeline-heading" className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="call-timeline-heading" className="text-sm font-semibold">{t("timelineTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("timelineHint")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block sm:w-72">
                <span className="sr-only">{t("searchLabel")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  data-testid="voip-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="min-h-11 pl-9"
                />
              </label>
              <div className="flex min-h-11 items-center gap-1 overflow-x-auto" aria-label={t("directionFilter")}>
                <SlidersHorizontal className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {["", "inbound", "outbound"].map((direction) => (
                  <Button
                    key={direction || "all"}
                    type="button"
                    variant={directionFilter === direction ? "secondary" : "ghost"}
                    size="sm"
                    className="min-h-11 shrink-0"
                    aria-pressed={directionFilter === direction}
                    onClick={() => { setDirectionFilter(direction); setPage(1) }}
                  >
                    {direction === "" ? tc("all") : direction === "inbound" ? t("inbound") : t("outbound")}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {loadError && summary && (
          <div data-testid="voip-refresh-error" role="alert" className="m-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span>{t("refreshFailed")}</span>
            <Button data-testid="voip-retry-refresh" variant="outline" size="sm" className="min-h-11" onClick={() => setRetryVersion((value) => value + 1)}>
              {t("retry")}
            </Button>
          </div>
        )}

        {loading && calls.length === 0 ? (
          <CallRowsSkeleton label={t("loadingCalls")} />
        ) : calls.length === 0 ? (
          <div data-testid={hasFilters ? "voip-no-results" : "voip-empty-state"} className="px-4 py-10 text-center">
            <Headphones className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">{hasFilters ? t("noMatchingCalls") : t("noCalls")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hasFilters ? t("noMatchingCallsHint") : t("noCallsHint")}</p>
            {hasFilters && (
              <Button data-testid="voip-clear-filters" type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => { setSearchInput(""); setSearchQuery(""); setDirectionFilter(""); setPage(1) }}>
                {t("clearFilters")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block" aria-busy={loading}>
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t("date")}</th>
                    <th className="px-3 py-2 font-medium">{t("call")}</th>
                    <th className="px-3 py-2 font-medium">{t("contact")}</th>
                    <th className="px-3 py-2 font-medium">{tc("status")}</th>
                    <th className="px-3 py-2 font-medium">{t("recording")}</th>
                    <th className="px-3 py-2 font-medium">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => <CallTableRow key={call.id} call={call} locale={locale} canCallBack={canCallBack} canOpenContacts={canOpenContacts} />)}
                </tbody>
              </table>
            </div>
            <ul className="divide-y lg:hidden" aria-busy={loading}>
              {calls.map((call) => <CallCard key={call.id} call={call} locale={locale} canCallBack={canCallBack} canOpenContacts={canOpenContacts} />)}
            </ul>
          </>
        )}

        {totalPages > 1 && (
          <nav className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3" aria-label={t("paginationLabel")}>
            <p className="text-xs text-muted-foreground">{t("pageStatus", { page, pages: totalPages, total: summary?.total ?? 0 })}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="min-h-11" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>{tc("back")}</Button>
              <Button variant="outline" size="sm" className="min-h-11" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>{tc("next")}</Button>
            </div>
          </nav>
        )}
      </section>
    </div>
  )
}

function CallJournalDetailSlot() {
  const searchParams = useSearchParams()
  // Avoid mounting then removing a loading card on the normal timeline route:
  // it produces a real layout shift while the dynamic journal chunk resolves.
  return searchParams.get("call") ? <CallJournalDetail /> : null
}

function CallTableRow({ call, locale, canCallBack, canOpenContacts }: { call: CallLog; locale: string; canCallBack: boolean; canOpenContacts: boolean }) {
  const t = useTranslations("voip")
  const directionLabel = call.direction === "inbound" ? t("inbound") : t("outbound")
  const phoneNumber = call.direction === "inbound" ? call.fromNumber : call.toNumber
  const diagnostic = dialFailureDiagnostic(call)
  const disposition = call.disposition
    ? isCallDisposition(call.disposition) ? t(CALL_DISPOSITION_I18N_KEYS[call.disposition]) : call.disposition
    : null

  return (
    <tr className="border-t align-top transition-colors hover:bg-muted/30 motion-reduce:transition-none">
      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDateTime(call.createdAt, locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
      <td className="px-3 py-3">
        <p className="flex items-center gap-2 font-medium">
          {call.direction === "inbound" ? <PhoneIncoming className="h-4 w-4" aria-hidden="true" /> : <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />}
          {directionLabel}
        </p>
        <p className="mt-1 font-mono text-xs">{phoneNumber}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("durationValue", { duration: durationLabel(call.duration) })}</p>
      </td>
      <td className="px-3 py-3">
        {call.contact ? (
          call.contactId && canOpenContacts
            ? <Link href={`/contacts/${call.contactId}`} className="inline-flex min-h-11 items-center rounded font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{call.contact.fullName}</Link>
            : <span className="text-sm">{call.contact.fullName}</span>
        ) : <span className="text-xs text-muted-foreground">{t("unknownContact")}</span>}
      </td>
      <td className="max-w-60 px-3 py-3">
        <CallStatusBadge status={call.status} />
        {disposition && <p className="mt-1 text-xs text-muted-foreground">{disposition}</p>}
        {diagnostic && <p className="mt-1 text-xs leading-4 text-muted-foreground">{formatDialDiagnostic(diagnostic, t)}</p>}
      </td>
      <td className="px-3 py-3">
        <CallRecordingPlayer url={call.recordingPlaybackUrl} callDurationSeconds={call.duration} callLabel={`${directionLabel} ${phoneNumber}`} />
      </td>
      <td className="px-3 py-3"><CallActions call={call} phoneNumber={phoneNumber} canCallBack={canCallBack} canOpenContacts={canOpenContacts} /></td>
    </tr>
  )
}

function CallCard({ call, locale, canCallBack, canOpenContacts }: { call: CallLog; locale: string; canCallBack: boolean; canOpenContacts: boolean }) {
  const t = useTranslations("voip")
  const directionLabel = call.direction === "inbound" ? t("inbound") : t("outbound")
  const phoneNumber = call.direction === "inbound" ? call.fromNumber : call.toNumber
  const diagnostic = dialFailureDiagnostic(call)
  const disposition = call.disposition
    ? isCallDisposition(call.disposition) ? t(CALL_DISPOSITION_I18N_KEYS[call.disposition]) : call.disposition
    : null

  return (
    <li className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {call.direction === "inbound" ? <PhoneIncoming className="h-4 w-4" aria-hidden="true" /> : <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />}
            {directionLabel}
          </p>
          <p className="mt-1 truncate font-mono text-sm">{phoneNumber}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(call.createdAt, locale)} · {durationLabel(call.duration)}</p>
        </div>
        <CallStatusBadge status={call.status} />
      </div>
      {call.contact ? (
        call.contactId && canOpenContacts
          ? <Link href={`/contacts/${call.contactId}`} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{call.contact.fullName}</Link>
          : <p className="text-sm font-medium">{call.contact.fullName}</p>
      ) : <p className="text-xs text-muted-foreground">{t("unknownContact")}</p>}
      {(disposition || diagnostic) && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {disposition && <p>{disposition}</p>}
          {diagnostic && <p className={cn(disposition && "mt-1")}>{formatDialDiagnostic(diagnostic, t)}</p>}
        </div>
      )}
      <CallRecordingPlayer url={call.recordingPlaybackUrl} callDurationSeconds={call.duration} callLabel={`${directionLabel} ${phoneNumber}`} />
      <CallActions call={call} phoneNumber={phoneNumber} canCallBack={canCallBack} canOpenContacts={canOpenContacts} />
    </li>
  )
}

function CallActions({ call, phoneNumber, canCallBack, canOpenContacts }: { call: CallLog; phoneNumber: string; canCallBack: boolean; canOpenContacts: boolean }) {
  const t = useTranslations("voip")
  const safePhone = phoneNumber.replace(/[^\d+]/g, "")
  return (
    <div className="flex flex-wrap gap-1.5">
      {safePhone && canCallBack && (
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <a href={`tel:${safePhone}`}>
            <Phone className="h-4 w-4" aria-hidden="true" />
            {t("callBack")}
          </a>
        </Button>
      )}
      {call.contactId && canOpenContacts && (
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href={`/contacts/${call.contactId}`}>{t("openContact")}</Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="min-h-11">
        <Link href={`?call=${encodeURIComponent(call.id)}`}>{t("openDetails")}</Link>
      </Button>
    </div>
  )
}

function VoipSkeleton({ label }: { label: string }) {
  return (
    <div data-testid="voip-loading" className="mx-auto max-w-[1180px] space-y-4" aria-busy="true" aria-label={label}>
      <div className="space-y-2 border-b pb-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-72 max-w-[80vw] animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      {[64, 126, 320].map((height) => <div key={height} className="animate-pulse rounded-lg border bg-muted/30 motion-reduce:animate-none" style={{ height }} />)}
      <span className="sr-only">{label}</span>
    </div>
  )
}

function CallRowsSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label={label}>
      {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />)}
      <span className="sr-only">{label}</span>
    </div>
  )
}
