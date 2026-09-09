"use client"

import { Suspense, useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDateTime } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Search, RefreshCw, Play, Clock, Settings, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { dialFailureDiagnostic, formatDialDiagnostic } from "@/lib/calls/dial-diagnostics"
import {
  CALL_DISPOSITION_I18N_KEYS,
  isCallDisposition,
} from "@/lib/calls/disposition"
import { MissedInboundQueue } from "@/components/voip/missed-inbound-queue"
import { CallJournalDetail } from "@/components/voip/call-journal-detail"
import { isManagerOrAbove } from "@/lib/constants"

interface CallLog {
  id: string
  direction: string
  status: string
  fromNumber: string
  toNumber: string
  contactId: string | null
  contact: { fullName: string; email: string | null } | null
  duration: number | null
  hasRecording?: boolean
  recordingPlaybackUrl: string | null
  disposition: string | null
  provider: string
  providerOutcome?: string | null
  providerDialStatus?: string | null
  providerHangupCause?: string | null
  createdAt: string
}

function fmtDuration(s: number | null | undefined): string {
  if (!s || s <= 0) return "0:00"
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`
}

function fmtTime(d: string, locale: string): string {
  return formatDateTime(d, locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

// Status -> color + i18n key suffix. Labels are resolved at render via
// t(`statusLabels.${key}`) so they follow the active locale.
const statusCfg: Record<string, { key: string; color: string }> = {
  initiated: { key: "initiated", color: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20" },
  ringing: { key: "ringing", color: "text-amber-600 bg-amber-50 dark:bg-amber-900/20" },
  "in-progress": { key: "inProgress", color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
  completed: { key: "completed", color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
  "no-answer": { key: "noAnswer", color: "text-orange-600 bg-orange-50 dark:bg-orange-900/20" },
  busy: { key: "busy", color: "text-red-600 bg-red-50 dark:bg-red-900/20" },
  failed: { key: "failed", color: "text-red-600 bg-red-50 dark:bg-red-900/20" },
}

export default function VoipCallsPage() {
  const { data: session } = useSession()
  const t = useTranslations("voip")
  const tc = useTranslations("common")
  const locale = useLocale()

  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [directionFilter, setDirectionFilter] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)
  const [testLoading, setTestLoading] = useState(false)

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" })
      if (directionFilter) params.set("direction", directionFilter)
      if (search) params.set("search", search)
      const res = await fetch(`/api/v1/calls?${params}`)
      if (res.ok) {
        const json = await res.json()
        setCalls(json.data || [])
        setTotalPages(json.pagination?.pages || 1)
        setTotal(json.pagination?.total || 0)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [page, directionFilter, search])

  const testConnection = async () => {
    setTestLoading(true)
    try {
      const res = await fetch("/api/v1/calls/test", { method: "POST" })
      const json = await res.json()
      setConnectionOk(json.success)
    } catch {
      setConnectionOk(false)
    } finally {
      setTestLoading(false)
    }
  }

  useEffect(() => { fetchCalls() }, [fetchCalls])
  useEffect(() => { testConnection() }, [])

  // Stats from current page (approximate — real stats would need a separate endpoint)
  const inbound = calls.filter(c => c.direction === "inbound").length
  const outbound = calls.filter(c => c.direction === "outbound").length
  const durations = calls.filter(c => c.duration).map(c => c.duration!)
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Phone className="h-6 w-6 text-violet-600" />
            {t("title")}
            <HelpButton slug="voip" variant="label" />
          </h1>
          <PageDescription text={t("description")} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card text-sm">
            {testLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <div className={cn("h-2 w-2 rounded-full", connectionOk === true ? "bg-green-500" : connectionOk === false ? "bg-red-500" : "bg-gray-400")} />
            )}
            <span className="text-muted-foreground">
              {connectionOk === true ? t("connectionConnected") : connectionOk === false ? t("connectionDisconnected") : t("connectionChecking")}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={testConnection} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> {t("testConnection")}
          </Button>
          <Link href="/settings/voip">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" /> {tc("settings")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Phone className="h-4 w-4" /> {t("totalCalls")}
          </div>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <PhoneIncoming className="h-4 w-4 text-blue-500" /> {t("inbound")}
          </div>
          <p className="text-2xl font-bold text-blue-600">{inbound}</p>
        </div>
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <PhoneOutgoing className="h-4 w-4 text-green-500" /> {t("outbound")}
          </div>
          <p className="text-2xl font-bold text-green-600">{outbound}</p>
        </div>
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Clock className="h-4 w-4 text-purple-500" /> {t("avgDuration")}
          </div>
          <p className="text-2xl font-bold text-purple-600">{fmtDuration(avgDuration)}</p>
        </div>
      </div>

      {isManagerOrAbove(session?.user?.role ?? "") && <MissedInboundQueue />}

      <Suspense
        fallback={(
          <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("journal.loading")}
          </div>
        )}
      >
        <CallJournalDetail />
      </Suspense>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder={t("searchPlaceholder")} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {["", "inbound", "outbound"].map(dir => (
            <Button key={dir} variant={directionFilter === dir ? "default" : "outline"} size="sm" onClick={() => { setDirectionFilter(dir); setPage(1) }}>
              {dir === "" ? tc("all") : dir === "inbound" ? t("inbound") : t("outbound")}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">{t("date")}</th>
              <th className="text-left p-3 font-medium">{t("direction")}</th>
              <th className="text-left p-3 font-medium">{t("number")}</th>
              <th className="text-left p-3 font-medium">{t("contact")}</th>
              <th className="text-left p-3 font-medium">{t("duration")}</th>
              <th className="text-left p-3 font-medium">{tc("status")}</th>
              <th className="text-left p-3 font-medium">{t("dispositionHeader")}</th>
              <th className="text-left p-3 font-medium">{t("recording")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b">{[...Array(8)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
              ))
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-muted-foreground">
                  <Phone className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">{t("noCalls")}</p>
                  <p className="text-xs mt-1">{t("noCallsHint")}</p>
                </td>
              </tr>
            ) : calls.map(call => {
              const sc = statusCfg[call.status] || statusCfg.completed
              const DirIcon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing
              const phoneNum = call.direction === "inbound" ? call.fromNumber : call.toNumber
              const dialDiagnostic = dialFailureDiagnostic(call)
              return (
                <tr key={call.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3 text-muted-foreground text-xs">{fmtTime(call.createdAt, locale)}</td>
                  <td className="p-3">
                    <DirIcon className={cn("h-4 w-4", call.direction === "inbound" ? "text-blue-500" : "text-green-500")} />
                  </td>
                  <td className="p-3 font-mono text-xs">{phoneNum}</td>
                  <td className="p-3">
                    {call.contact ? (
                      <Link href={`/contacts/${call.contactId}`} className="text-primary hover:underline text-xs">{call.contact.fullName}</Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3 font-mono text-xs">{fmtDuration(call.duration)}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={cn("text-[10px]", sc.color)}>{t(`statusLabels.${sc.key}`)}</Badge>
                    {dialDiagnostic && (
                      <div className="mt-1 max-w-56 text-[10px] leading-4 text-muted-foreground" title={t("dialDiagnostics.title")}>
                        {formatDialDiagnostic(dialDiagnostic, t)}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {call.disposition
                      ? (isCallDisposition(call.disposition)
                          ? t(CALL_DISPOSITION_I18N_KEYS[call.disposition])
                          : call.disposition)
                      : "—"}
                  </td>
                  <td className="p-3">
                    {call.recordingPlaybackUrl ? (
                      <a href={call.recordingPlaybackUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-700"><Play className="h-4 w-4" /></a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t bg-muted/30">
            <p className="text-xs text-muted-foreground">{page} / {totalPages} ({total} {t("totalCalls").toLowerCase()})</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{tc("back")}</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{tc("next")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
