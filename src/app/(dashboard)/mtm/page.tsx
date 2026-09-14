"use client"

import { useEffect, useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { OperationalWeekHome } from "@/components/mtm/operational-week-home"
import { Button } from "@/components/ui/button"
import { createDateFormatter, formatDate, formatTime } from "@/lib/format-date"
import Link from "next/link"
import {
  MapPin, Route, CheckSquare,
  Check, LifeBuoy, Mail, Megaphone, Phone,
} from "lucide-react"

function DashboardClock({ locale, timezone }: { locale: string; timezone: string | null }) {
  const [clock, setClock] = useState<Date | null>(null)
  useEffect(() => {
    setClock(new Date())
    // C16: the panel shows hours and minutes, so ticking every second only
    // re-rendered the same string 59 times out of 60. Half a minute is close
    // enough for a clock that cannot show seconds anyway.
    const interval = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  return (
    <div className="text-left text-muted-foreground sm:text-right">
      <div className="text-xs">{clock ? formatDate(clock, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", ...(timezone ? { timeZone: timezone } : {}) }) : "—"}</div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {clock ? formatTime(clock, locale, { hour: "2-digit", minute: "2-digit", hour12: false, ...(timezone ? { timeZone: timezone } : {}) }) : "--:--"}
      </div>
    </div>
  )
}

export default function MtmDashboardPage() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("nav")
  const td = useTranslations("mtmDashboardPage")
  const [operationalResult, setOperationalResult] = useState<{ scopeKey: string; data: {
    announcement: {
      messageId: string
      title: string
      body: string
      effectiveUntil: string
      acknowledgedAt: string | null
    } | null
    support: { email: string | null; phone: string | null }
    timezone: string
  } } | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)
  const [operationalLoading, setOperationalLoading] = useState(true)
  const [operationalError, setOperationalError] = useState(false)
  const [operationalRetry, setOperationalRetry] = useState(0)
  const orgId = session?.user?.organizationId
  const viewerKey = session?.user?.id || session?.user?.email || "no-viewer"
  const operationalScopeKey = `${orgId || "no-org"}:${viewerKey}:${locale}`
  const operational = operationalResult?.scopeKey === operationalScopeKey ? operationalResult.data : null
  const operationalRequestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++operationalRequestIdRef.current
    const requestScopeKey = `${orgId || "no-org"}:${viewerKey}:${locale}`
    const controller = new AbortController()
    setOperationalResult(null)
    setOperationalLoading(true)
    setOperationalError(false)
    fetch(`/api/v1/mtm/operational-announcement?locale=${encodeURIComponent(locale)}`, {
      headers: orgId ? { "x-organization-id": String(orgId) } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) throw new Error(result.error || td("announcementLoadFailed"))
        if (requestId === operationalRequestIdRef.current) {
          setOperationalResult({ scopeKey: requestScopeKey, data: result.data })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestId === operationalRequestIdRef.current) setOperationalError(true)
      })
      .finally(() => {
        if (requestId === operationalRequestIdRef.current) setOperationalLoading(false)
      })
    return () => controller.abort()
  }, [locale, operationalRetry, orgId, td, viewerKey])

  async function acknowledgeAnnouncement() {
    if (!operational?.announcement || operational.announcement.acknowledgedAt) return
    setAcknowledging(true)
    try {
      const response = await fetch("/api/v1/mtm/operational-announcement", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ messageId: operational.announcement.messageId }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || td("announcementAckFailed"))
      setOperationalResult((current) => current?.scopeKey === operationalScopeKey && current.data.announcement ? {
        ...current,
        data: {
          ...current.data,
          announcement: { ...current.data.announcement, acknowledgedAt: result.data.acknowledgedAt },
        },
      } : current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : td("announcementAckFailed"))
    } finally {
      setAcknowledging(false)
    }
  }

  const userName = session?.user?.name?.split(" ")[0] || ""

  return (
    <div className="space-y-5">
      {/* Header with greeting and live clock */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {userName && <h2 className="text-lg font-semibold mb-0.5">{td("welcomeBack", { name: userName })}</h2>}
          <div className="flex items-center gap-2">
            <PageDescription
              icon={MapPin}
              title={t("mtmDashboard")}
              description={td("subtitle")}
            />
            <HelpButton slug="mtm-overview" variant="label" />
          </div>
        </div>
        <DashboardClock
          locale={locale}
          timezone={typeof operational?.timezone === "string" ? operational.timezone : null}
        />
      </div>

      {/* One clear daily path. Administration and reports remain in “All MTM tools”. */}
      <section aria-labelledby="mtm-next-step" className="flex flex-col gap-3 border-y border-zinc-200 py-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="mtm-next-step" className="text-sm font-semibold">{td("nextStepTitle")}</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{td("nextStepHint")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href="/mtm/routes"><Button className="min-h-11 w-full sm:w-auto"><Route className="mr-2 h-4 w-4" />{td("openPlan")}</Button></Link>
          <Link href="/mtm/visits"><Button variant="outline" className="min-h-11 w-full sm:w-auto"><CheckSquare className="mr-2 h-4 w-4" />{td("openVisits")}</Button></Link>
          <Link href="/mtm/map"><Button variant="ghost" className="min-h-11 w-full sm:w-auto"><MapPin className="mr-2 h-4 w-4" />{td("openMap")}</Button></Link>
        </div>
      </section>

      {operationalLoading ? (
        <div className="h-24 animate-pulse border-y border-zinc-200 bg-muted/40 motion-reduce:animate-none dark:border-zinc-700" aria-label={td("announcementLoading")} />
      ) : operationalError ? (
        <section className="flex flex-col gap-3 border-y border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{td("announcementLoadFailed")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{td("announcementLoadFailedHint")}</p>
          </div>
          <Button variant="outline" className="min-h-11 shrink-0" onClick={() => setOperationalRetry((value) => value + 1)}>
            {td("announcementRetry")}
          </Button>
        </section>
      ) : (operational?.announcement || operational?.support.email || operational?.support.phone) ? (
        <section className="grid border-y border-zinc-200 bg-card dark:border-zinc-700 lg:grid-cols-[minmax(0,1fr)_320px]">
          {operational.announcement ? (
            <div className="p-4 lg:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Megaphone className="h-4 w-4" />{td("keyMessage")}
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{operational.announcement.title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{operational.announcement.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {td("announcementValidUntil", {
                      date: createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" })
                        .format(new Date(operational.announcement.effectiveUntil)),
                    })}
                  </p>
                </div>
                {operational.announcement.acknowledgedAt ? (
                  <span className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <Check className="h-4 w-4" />{td("announcementAcknowledged")}
                  </span>
                ) : (
                  <Button className="min-h-11 shrink-0" onClick={acknowledgeAnnouncement} disabled={acknowledging}>
                    <Check className="mr-2 h-4 w-4" />{acknowledging ? td("announcementAcknowledging") : td("announcementAcknowledge")}
                  </Button>
                )}
              </div>
            </div>
          ) : <div className="hidden lg:block" />}
          {(operational.support.email || operational.support.phone) ? (
            <aside className="border-t border-zinc-200 p-4 dark:border-zinc-700 lg:border-l lg:border-t-0 lg:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><LifeBuoy className="h-4 w-4 text-primary" />{td("supportTitle")}</div>
              <p className="mt-1 text-xs text-muted-foreground">{td("supportHint")}</p>
              <div className="mt-3 space-y-2 text-sm">
                {operational.support.email ? (
                  <a className="flex min-h-10 items-center gap-2 hover:text-primary" href={`mailto:${encodeURIComponent(operational.support.email)}`}>
                    <Mail className="h-4 w-4" />{operational.support.email}
                  </a>
                ) : null}
                {operational.support.phone ? (
                  <a className="flex min-h-10 items-center gap-2 hover:text-primary" href={`tel:${operational.support.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone className="h-4 w-4" />{operational.support.phone}
                  </a>
                ) : null}
              </div>
            </aside>
          ) : null}
        </section>
      ) : null}

      <OperationalWeekHome
        key={`${orgId || "no-org"}:${session?.user?.id || session?.user?.email || "no-viewer"}`}
        organizationId={orgId ? String(orgId) : null}
        viewerId={session?.user?.id || session?.user?.email || null}
      />

    </div>
  )
}
