"use client"

import { useEffect, useMemo, useState, type MouseEvent } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Building2, CheckCircle2, Clock3, FileText, Globe, Mail, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, RefreshCw, Search, SlidersHorizontal, User, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InfoHint } from "@/components/info-hint"
import { LateCallbacksView } from "@/components/leads/late-callbacks-panel"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { CallRecordingPlayer } from "@/components/voip/call-recording-player"
import { CALL_DISPOSITIONS, CALL_DISPOSITION_I18N_KEYS, isCallDisposition } from "@/lib/calls/disposition"
import { callStatusLabelKey } from "@/lib/calls/status-label"
import { formatDateTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import { mtmDemoToday } from "./mtm-demo-data"
import {
  CALLS_DEMO_LEAD,
  CALLS_DEMO_PROVIDER,
  CALLS_DEMO_SELLER,
  CALLS_DEMO_TALK_SECONDS,
  callsDemoAlerts,
  callsDemoCallbackAt,
  callsDemoLateCallbacks,
  callsDemoLog,
  callsDemoNow,
  callsDemoSummary,
  type CallsDemoCall,
} from "./calls-demo-data"

/**
 * Call Center: calls from the CRM, a module of its own beside the lead story
 * (owner, 2026-10-13: Omni Channel → Service Desk → Call Center → Route &
 * Field → Contracts), on what every tenant with 3CX has (2026-10-17: «только
 * то, что у всех»).
 *
 * Three product pages: «VoIP Zənglər» (support/voip/page.tsx), the lead
 * card's «Lid məlumatı» with its call button and the call window
 * (call-widget.tsx), and the leads analytics' «Müştərilərə gecikmiş zənglər»
 * — that one is the product's own `LateCallbacksView`. The other two fetch
 * their data and a page file cannot export its parts, so their markup is
 * redrawn here line for line with the product's words; the summary, the
 * promise report and the alerts are computed by the product's own rules
 * (`calls-demo-data.ts`).
 *
 * What the screens say is what the product does: the call button first asks
 * which service to use, 3CX rings the integration's extension and then the
 * customer, a «Geri zəng» outcome asks for a time and files a task for the
 * caller, and the escalation job tells the seller at that time and the
 * managers 45 minutes later if the task is still open.
 */

type CallsScreen = "log" | "call" | "promise"

const SCREEN_OF: Record<string, CallsScreen> = {
  "cc-log": "log",
  "cc-call": "call",
  "cc-promise": "promise",
}

/** Rows on screen: the top of the log's first page (the page itself holds 25). */
const LOG_ROWS = 6

const FAILURE_STATUSES = new Set(["no-answer", "busy", "failed"])

function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—"
  return `${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, "0")}`
}

function useCallsDemo(props: DemoSceneProps) {
  const { snapshot, step, reviewMode, dispatch, hint } = props
  const today = mtmDemoToday(snapshot.startedAt)
  /** The step's own control, or a word on where to look instead. */
  const press = (stepId: string, path: string, value: string | boolean = true) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return false
    }
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return false
    }
    dispatch({ type: "ui", path, value })
    return true
  }
  return { today, press }
}

export function CallsScene(props: DemoSceneProps) {
  const { section, hint } = props
  const screen = SCREEN_OF[section.id] ?? "log"

  const keepInDemo = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element | null)?.closest?.("a[href]")
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }

  return (
    <div data-testid="demo-scene-calls" className="space-y-4" onClickCapture={keepInDemo}>
      {screen === "log" && <LogScreen {...props} />}
      {screen === "call" && <CallScreen {...props} />}
      {screen === "promise" && <PromiseScreen {...props} />}
    </div>
  )
}

/* ── VoIP Zənglər ─────────────────────────────────────────────────────── */

function CallStatusBadge({ status }: { status: string }) {
  const t = useTranslations("voip")
  return (
    <Badge variant={FAILURE_STATUSES.has(status) ? "destructive" : "outline"} className="whitespace-nowrap text-xs">
      {t(`statusLabels.${callStatusLabelKey(status)}`)}
    </Badge>
  )
}

function LogScreen(props: DemoSceneProps) {
  const { snapshot, hint } = props
  const t = useTranslations("voip")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { today, press } = useCallsDemo(props)
  const direction = typeof snapshot.ui["cc.direction"] === "string" ? (snapshot.ui["cc.direction"] as string) : ""
  const calls = useMemo(() => callsDemoLog(today), [today])
  // The summary reads the same filtered calls as the list, as the page does.
  const filtered = useMemo(() => (direction ? calls.filter((call) => call.direction === direction) : calls), [calls, direction])
  const summary = useMemo(() => callsDemoSummary(filtered), [filtered])
  const rows = filtered.slice(0, LOG_ROWS)

  const metricItems = [
    { key: "total", label: t("totalCalls"), value: summary.total, icon: Phone },
    { key: "inbound", label: t("inbound"), value: summary.inbound, icon: PhoneIncoming },
    { key: "outbound", label: t("outbound"), value: summary.outbound, icon: PhoneOutgoing },
    { key: "missed", label: t("missed"), value: summary.missed, icon: PhoneMissed },
    { key: "duration", label: t("avgDuration"), value: durationLabel(summary.averageDurationSeconds), icon: Clock3, sample: summary.durationSample },
  ]

  return (
    <SupportPageShell
      data-testid="voip-workspace"
      width="wide"
      title={t("title")}
      description={t("description")}
      leading={<Phone className="h-5 w-5" aria-hidden="true" />}
    >
      <aside className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between" aria-label={t("connectionStatus")}>
        <div className="flex min-h-11 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("connectionState.configured")}</p>
            <p className="text-xs text-muted-foreground">{t("connectionAgentHint")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => hint(S.demoButtonHint)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("refreshConnection")}
          </Button>
        </div>
      </aside>

      <section data-tour-id="cc-log-summary" aria-labelledby="cc-call-summary-heading" className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <div>
            <h2 id="cc-call-summary-heading" className="text-sm font-semibold">{t("summaryTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("rolling30Days")}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => hint(S.demoButtonHint)} aria-label={t("refreshCalls")}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
                  <span>{item.value}</span>
                  {item.sample != null && <span className="block text-xs font-normal text-muted-foreground">{t("durationSample", { count: item.sample })}</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      <section data-tour-id="cc-log-timeline" aria-labelledby="cc-call-timeline-heading" className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="cc-call-timeline-heading" className="text-sm font-semibold">{t("timelineTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("timelineHint")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block sm:w-72">
                <span className="sr-only">{t("searchLabel")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value="" readOnly onClick={() => hint(S.demoButtonHint)} placeholder={t("searchPlaceholder")} className="min-h-11 pl-9" />
              </label>
              <div className="flex min-h-11 items-center gap-1 overflow-x-auto" aria-label={t("directionFilter")}>
                <SlidersHorizontal className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {["", "inbound", "outbound"].map((value) => (
                  <Button
                    key={value || "all"}
                    type="button"
                    variant={direction === value ? "secondary" : "ghost"}
                    size="sm"
                    className="min-h-11 shrink-0"
                    aria-pressed={direction === value}
                    onClick={() => (value === "inbound" ? press("cc-log-filter", "cc.direction", "inbound") : hint(S.callsFilterHint))}
                    {...(value === "inbound" && direction !== "inbound" ? demoTarget("cc-log-filter") : {})}
                  >
                    {value === "" ? tc("all") : value === "inbound" ? t("inbound") : t("outbound")}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <table className="w-full text-sm">
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
              {rows.map((call) => <CallTableRow key={call.id} call={call} locale={locale} />)}
            </tbody>
          </table>
        </div>
        <ul className="divide-y lg:hidden">
          {rows.map((call) => <CallCard key={call.id} call={call} locale={locale} />)}
        </ul>
      </section>
    </SupportPageShell>
  )
}

function useCallParts(call: CallsDemoCall) {
  const t = useTranslations("voip")
  const directionLabel = call.direction === "inbound" ? t("inbound") : t("outbound")
  const phoneNumber = call.direction === "inbound" ? call.fromNumber : call.toNumber
  const disposition = call.disposition && isCallDisposition(call.disposition) ? t(CALL_DISPOSITION_I18N_KEYS[call.disposition]) : null
  return { t, directionLabel, phoneNumber, disposition }
}

function CallContact({ call, className }: { call: CallsDemoCall; className: string }) {
  const t = useTranslations("voip")
  return call.contactName
    ? <Link href="/contacts" className={className}>{call.contactName}</Link>
    : <span className="text-xs text-muted-foreground">{t("unknownContact")}</span>
}

function CallTableRow({ call, locale }: { call: CallsDemoCall; locale: string }) {
  const { t, directionLabel, phoneNumber, disposition } = useCallParts(call)
  return (
    <tr className="border-t align-top transition-colors hover:bg-muted/30">
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
        <CallContact call={call} className="inline-flex min-h-11 items-center rounded font-medium underline-offset-4 hover:underline" />
      </td>
      <td className="max-w-60 px-3 py-3">
        <CallStatusBadge status={call.status} />
        {disposition && <p className="mt-1 text-xs text-muted-foreground">{disposition}</p>}
      </td>
      <td className="px-3 py-3">
        <CallRecordingPlayer url={null} callDurationSeconds={call.duration} callLabel={`${directionLabel} ${phoneNumber}`} />
      </td>
      <td className="px-3 py-3"><CallActions call={call} phoneNumber={phoneNumber} /></td>
    </tr>
  )
}

function CallCard({ call, locale }: { call: CallsDemoCall; locale: string }) {
  const { directionLabel, phoneNumber, disposition } = useCallParts(call)
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
      <CallContact call={call} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline" />
      {disposition && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p>{disposition}</p>
        </div>
      )}
      <CallRecordingPlayer url={null} callDurationSeconds={call.duration} callLabel={`${directionLabel} ${phoneNumber}`} />
      <CallActions call={call} phoneNumber={phoneNumber} />
    </li>
  )
}

function CallActions({ call, phoneNumber }: { call: CallsDemoCall; phoneNumber: string }) {
  const t = useTranslations("voip")
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <a href={`tel:${phoneNumber.replace(/[^\d+]/g, "")}`}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          {t("callBack")}
        </a>
      </Button>
      {call.contactName && (
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/contacts">{t("openContact")}</Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="min-h-11">
        <a href={`?call=${encodeURIComponent(call.id)}`}>{t("openDetails")}</a>
      </Button>
    </div>
  )
}

/* ── The lead card: «Zəng», the call window, the outcome ─────────────── */

/** The browser's local wall time for a datetime-local input, as the call window writes it. */
function toDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Runs the call window's clock in a browser; jsdom's walk keeps the start. */
function useTalkClock(running: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running || typeof navigator === "undefined" || navigator.userAgent.includes("jsdom")) return
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return seconds
}

function CallScreen(props: DemoSceneProps) {
  const { snapshot, step, hint } = props
  const t = useTranslations("leads")
  const tc = useTranslations("common")
  const tv = useTranslations("voip")
  const locale = useLocale()
  const { today, press } = useCallsDemo(props)
  const lead = CALLS_DEMO_LEAD

  const dialed = snapshot.ui["cc.dialed"] === true
  const ended = snapshot.ui["cc.ended"] === true
  const callback = snapshot.ui["cc.outcome"] === "callback"
  const saved = snapshot.ui["cc.saved"] === true
  const [pickerOpen, setPickerOpen] = useState(false)
  // One service is ready, so the picker opens with it chosen — as the button does.
  const [providerId, setProviderId] = useState<string>(CALLS_DEMO_PROVIDER.id)
  // The picker stays beside the button once it has opened, as in the product.
  const showPicker = pickerOpen || dialed
  // The time Fərid asked for, already in the field: the next screens follow
  // this one promise, so the demo does not let it be moved.
  const promised = callsDemoCallbackAt(today)
  const talk = useTalkClock(dialed && !ended)
  const active = dialed && !ended
  const duration = ended ? CALLS_DEMO_TALK_SECONDS : talk

  const dial = () => {
    if (dialed) {
      hint(S.demoButtonHint)
      return
    }
    if (!pickerOpen) {
      if (step?.id !== "cc-call-dial") {
        press("cc-call-dial", "cc.dialed")
        return
      }
      setPickerOpen(true)
      return
    }
    if (!providerId) {
      hint(tv("callProviderRequired"))
      return
    }
    press("cc-call-dial", "cc.dialed")
  }

  const chooseOutcome = (value: string) => {
    if (value === "callback") {
      press("cc-call-outcome", "cc.outcome", "callback")
      return
    }
    hint(step?.id === "cc-call-outcome" ? S.callsOutcomeHint : S.hintFollow(step?.title ?? ""))
  }


  const status = active ? "initiated" : "completed"
  const statusColors: Record<string, string> = { initiated: "text-yellow-500", completed: "text-muted-foreground" }

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 items-start gap-3">
        <Button className="shrink-0" variant="ghost" size="icon" onClick={() => hint(S.demoButtonHint)} aria-label={tc("back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {lead.contactName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-bold">{lead.contactName}</h1>
                <Badge className="bg-blue-100 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{t("statusNew")}</Badge>
                <Badge className="bg-yellow-100 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{t("priorityMedium")}</Badge>
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> {lead.companyName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{lead.email}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card data-tour-id="cc-call-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base">{t("modalLeadInfo")} <InfoHint text={t("hintColContact")} size={14} /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("modalContactName")}:</span>
                <span className="font-medium">{lead.contactName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("modalCompany")}:</span>
                <span className="font-medium">{lead.companyName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{tc("email")}:</span>
                <a href={`mailto:${lead.email}`} className="font-medium text-primary hover:underline">{lead.email}</a>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Phone className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("modalPhone")}:</span>
                <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-primary hover:underline">{lead.phone}</a>
                {showPicker ? (
                  <select
                    aria-label={tv("chooseCallProvider")}
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                    className="h-8 max-w-[11rem] rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm"
                  >
                    <option value="">{tv("callProviderPlaceholder")}</option>
                    <option value={CALLS_DEMO_PROVIDER.id}>{CALLS_DEMO_PROVIDER.label}</option>
                  </select>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={dial}
                  disabled={showPicker && !providerId}
                  title={`${tv("call")} ${lead.phone}`}
                  aria-label={`${tv("call")} ${lead.phone}`}
                  className="h-8 w-8"
                  {...(dialed ? {} : demoTarget("cc-call-dial"))}
                >
                  <Phone className="h-4 w-4 text-green-600" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("modalSource")}:</span>
                <span className="font-medium">{t("sourceWebsite")}</span>
                <InfoHint text={t("hintColSource")} size={12} />
              </div>
            </div>
          </CardContent>
        </Card>

        {dialed ? (
          <Card data-tour-id="cc-call-widget" className="border-2 border-primary/20 shadow-2xl">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className={`h-5 w-5 ${active ? "animate-pulse text-green-500" : "text-muted-foreground"}`} />
                  <span className="text-sm font-semibold">{active ? tv("activeCall") : tv("callEnded")}</span>
                </div>
                <button type="button" onClick={() => hint(S.demoButtonHint)} aria-label={tv("dismiss")} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="font-medium">{lead.contactName}</div>
                <div className="text-sm text-muted-foreground">{lead.phone}</div>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium capitalize ${statusColors[status] || ""}`}>{tv(`statusLabels.${callStatusLabelKey(status)}`)}</span>
                  {active && <span className="font-mono text-sm">{durationLabel(duration) === "—" ? "0:00" : durationLabel(duration)}</span>}
                  {!active && duration > 0 && <span className="text-sm text-muted-foreground">{durationLabel(duration)}</span>}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                {active && (
                  <Button variant="destructive" size="sm" className="flex-1" onClick={() => press("cc-call-end", "cc.ended")} {...demoTarget("cc-call-end")}>
                    <PhoneOff className="mr-1 h-4 w-4" /> {tv("endCall")}
                  </Button>
                )}
                <Button variant="outline" size="sm" className="flex-1" onClick={() => hint(S.demoButtonHint)}>
                  <FileText className="mr-1 h-4 w-4" /> {tv("callNote")}
                </Button>
              </div>

              {!active && (
                <div className="mt-3 space-y-2">
                  <label htmlFor="cc-call-disposition" className="text-xs font-medium text-muted-foreground">{tv("callOutcome")}</label>
                  <select
                    id="cc-call-disposition"
                    className="w-full rounded-md border border-zinc-200 bg-background p-1.5 text-sm dark:border-zinc-700"
                    value={callback ? "callback" : ""}
                    disabled={saved}
                    onChange={(event) => chooseOutcome(event.target.value)}
                    {...(callback ? {} : demoTarget("cc-call-outcome"))}
                  >
                    <option value="">{tv("selectOutcome")}</option>
                    {CALL_DISPOSITIONS.map((value) => (
                      <option key={value} value={value}>{tv(CALL_DISPOSITION_I18N_KEYS[value])}</option>
                    ))}
                  </select>
                  {callback ? (
                    <div className="grid gap-1.5">
                      <label htmlFor="cc-call-callback" className="text-xs font-medium text-muted-foreground">{tv("outcomePicker.callbackWhen")}</label>
                      <Input
                        type="datetime-local"
                        id="cc-call-callback"
                        value={toDateTimeLocalValue(new Date(promised))}
                        min={toDateTimeLocalValue(new Date(callsDemoNow(today)))}
                        required
                        readOnly
                        onClick={() => (saved ? undefined : hint(S.callsTimeHint))}
                      />
                      <Button type="button" size="sm" disabled={saved} onClick={() => press("cc-call-callback", "cc.saved")} {...(saved ? {} : demoTarget("cc-call-callback"))}>
                        {tv("outcomePicker.saveCallback")}
                      </Button>
                    </div>
                  ) : null}
                  {saved ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
                      {tv("outcomePicker.callbackSaved", { time: formatDateTime(promised, locale) })}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

/* ── The promise: the alerts and the late-callbacks report ───────────── */

function PromiseScreen(props: DemoSceneProps) {
  const t = useTranslations("leads")
  const tn = useTranslations("notifications")
  const { today } = useCallsDemo(props)
  const promised = callsDemoCallbackAt(today)
  const alerts = useMemo(() => callsDemoAlerts(promised), [promised])
  const report = useMemo(() => callsDemoLateCallbacks(today), [today])
  const typeColors: Record<string, string> = { warning: "bg-yellow-500", error: "bg-red-500" }
  const recipients: Record<string, string> = { assignee: S.callsAlertSeller(CALLS_DEMO_SELLER), manager: S.callsAlertManagers }

  return (
    <div className="space-y-6">
      <section data-tour-id="cc-promise-alerts" className="space-y-3">
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map((alert) => (
            <div key={alert.id} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{recipients[alert.id]}</p>
              <div className="w-full max-w-80 overflow-hidden rounded-lg border border-zinc-200 bg-background shadow-xl dark:border-zinc-700">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h4 className="text-sm font-medium">{tn("title")}</h4>
                </div>
                <div className="border-b bg-muted/30 px-4 py-3 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${typeColors[alert.type]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{alert.message}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{S.callsAlertNote}</p>
      </section>

      <section data-tour-id="cc-promise-report" className="space-y-3" data-testid="late-callbacks-section">
        <h2 className="text-lg font-semibold">{t("lateCallbacksTitle")}</h2>
        <LateCallbacksView report={report} />
      </section>
    </div>
  )
}
