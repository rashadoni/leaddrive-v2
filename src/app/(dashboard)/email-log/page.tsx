"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { ColorStatCard } from "@/components/color-stat-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Mail, Send, Inbox, CheckCircle, AlertTriangle, RotateCcw, Search, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownLeft, Filter, RefreshCw, Sparkles, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { sanitizeRichHtml } from "@/lib/sanitize"

import { useLocale } from "next-intl"

interface EmailLogEntry {
  id: string
  direction: string
  fromEmail: string
  toEmail: string
  subject: string | null
  body: string | null
  status: string
  errorMessage: string | null
  campaignId: string | null
  templateId: string | null
  contactId: string | null
  sentBy: string | null
  messageId: string | null
  createdAt: string
}

interface Stats {
  total: number
  outbound: number
  inbound: number
  sent: number
  failed: number
  bounced: number
}

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  sent: "bg-green-100 text-green-700",
  delivered: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  bounced: "bg-orange-100 text-orange-700",
}

export default function EmailLogPage() {
  const { data: session } = useSession()
  const t = useTranslations("emailLog")
  const tc = useTranslations("common")
  const locale = useLocale()
  const orgId = session?.user?.organizationId

  const statusLabels: Record<string, string> = {
    pending: t("statusPending"),
    sent: t("statusSent"),
    delivered: t("statusDelivered"),
    failed: t("statusFailed"),
    bounced: t("statusBounced"),
  }

  const [logs, setLogs] = useState<EmailLogEntry[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, outbound: 0, inbound: 0, sent: 0, failed: 0, bounced: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [filterDirection, setFilterDirection] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 30

  const fetchLogs = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) params.set("search", search)
      if (filterStatus) params.set("status", filterStatus)
      if (filterDirection) params.set("direction", filterDirection)

      const res = await fetch(`/api/v1/email-log?${params}`, {
        headers: { "x-organization-id": String(orgId) },
      })
      const json = await res.json()
      if (json.success) {
        setLogs(json.data.logs)
        setTotal(json.data.total)
        setStats(json.data.stats)
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [orgId, page, search, filterStatus, filterDirection])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)
    setAiOpen(true)
    try {
      const res = await fetch("/api/v1/email-log/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ lang: locale }),
      })
      const json = await res.json()
      if (json.success) {
        setAiResult(json.data.analysis)
      } else {
        setAiError(json.error || "Analysis failed")
      }
    } catch {
      setAiError(tc("errorNetwork"))
    } finally {
      setAiLoading(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")}<HelpButton slug="email-log" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-1">
          <RefreshCw className="h-4 w-4" /> {tc("refresh")}
        </Button>
      </div>

      {/* Da Vinci AI button */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={runAiAnalysis}
          disabled={aiLoading || stats.total === 0}
          className="relative overflow-hidden bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] hover:opacity-90 text-white border-0 shadow-md shadow-[hsl(var(--ai-from))]/25 hover:shadow-lg hover:shadow-[hsl(var(--ai-from))]/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
        >
          {aiLoading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <span className="relative mr-1.5 flex h-4 w-4 items-center justify-center">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </span>
          )}
          Da Vinci {tc("analytics").toLowerCase()}
        </Button>
      </div>

      {/* Da Vinci AI Analysis Card */}
      {aiOpen && (
        <div className="rounded-xl border border-[hsl(var(--ai-from))]/20 bg-card p-5">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))]">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-sm font-semibold">Da Vinci — {t("title")}</h3>
            </div>
            <button onClick={() => { setAiOpen(false); setAiResult(null) }} className="p-1 rounded-md hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}...
            </div>
          )}
          {aiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
              {aiError}
            </div>
          )}
          {aiResult && (
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{aiResult}</div>
          )}
        </div>
      )}

      <PageDescription text={t("pageDescription")} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <ColorStatCard label={t("total")} value={stats.total} icon={<Mail className="h-4 w-4" />} hint={t("hintTotalEmails")} />
        <ColorStatCard label={t("outbound")} value={stats.outbound} icon={<Send className="h-4 w-4" />} hint={t("hintOutbound")} />
        <ColorStatCard label={t("inbound")} value={stats.inbound} icon={<Inbox className="h-4 w-4" />} hint={t("hintInbound")} />
        <ColorStatCard label={t("sent")} value={stats.sent} icon={<CheckCircle className="h-4 w-4" />} hint={t("hintSentCount")} />
        <ColorStatCard label={t("failed")} value={stats.failed} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintFailedCount")} />
        <ColorStatCard label={t("bounced")} value={stats.bounced} icon={<RotateCcw className="h-4 w-4" />} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={filterDirection}
            onChange={e => { setFilterDirection(e.target.value); setPage(1) }}
            className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">{t("allDirections")}</option>
            <option value="outbound">{t("filterOutbound")}</option>
            <option value="inbound">{t("filterInbound")}</option>
          </select>
          <InfoHint text={t("hintColStatus")} size={12} />
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
            className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">{t("allStatuses")}</option>
            <option value="sent">{statusLabels.sent}</option>
            <option value="delivered">{statusLabels.delivered}</option>
            <option value="failed">{statusLabels.failed}</option>
            <option value="bounced">{statusLabels.bounced}</option>
            <option value="pending">{statusLabels.pending}</option>
          </select>
        </div>
      </div>

      {/* Email list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="mx-auto h-12 w-12 mb-4 opacity-40" />
          <p className="text-lg font-medium">{t("noEmails")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, index) => {
            const isExpanded = expandedId === log.id
            const isOutbound = log.direction === "outbound"
            const logNumber = total - ((page - 1) * limit + index)

            return (
              <div
                key={log.id}
                className={cn(
                  "border border-zinc-200 dark:border-zinc-700 rounded-lg transition-all",
                  log.status === "failed" ? "bg-red-50/50 dark:bg-red-900/10 border-red-200" :
                  log.status === "bounced" ? "bg-orange-50/50 dark:bg-orange-900/10 border-orange-200" :
                  isOutbound ? "bg-green-50/30 dark:bg-green-900/5" : "bg-blue-50/30 dark:bg-blue-900/5"
                )}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {isOutbound ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                            <ArrowUpRight className="h-3 w-3" /> {t("filterOutbound")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                            <ArrowDownLeft className="h-3 w-3" /> {t("filterInbound")}
                          </span>
                        )}
                        <span className="font-semibold text-sm truncate">{log.subject || t("noSubject")}</span>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusColors[log.status] || "bg-muted text-muted-foreground")}>
                          {statusLabels[log.status] || log.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("from")}: <span className="text-foreground">{log.fromEmail}</span></span>
                        <span>{t("to")}: <span className="text-foreground">{log.toEmail}</span></span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span>{tc("date")}: {new Date(log.createdAt).toLocaleString()}</span>
                        {log.sentBy && <span>{t("sentBy")}: {log.sentBy}</span>}
                        {log.campaignId && <span className="text-primary">{t("campaign")}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-lg font-bold text-muted-foreground/50">#{logNumber}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t">
                    {log.errorMessage && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-md text-sm text-red-700 dark:text-red-400">
                        <span className="font-medium">{t("errorLabel")}:</span> {log.errorMessage}
                      </div>
                    )}
                    {log.messageId && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        Message-ID: <span className="font-mono">{log.messageId}</span>
                      </div>
                    )}
                    {log.body ? (
                      <div className="mt-3">
                        <div className="text-xs text-muted-foreground mb-2 font-medium">{t("messagePreview")}:</div>
                        <div className="border border-zinc-200 dark:border-zinc-700 rounded-md bg-card p-4 max-h-72 overflow-y-auto">
                          <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(log.body || "") }} className="text-sm prose prose-sm max-w-none" />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-muted-foreground italic">{t("noContent")}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("showing", { from: (page - 1) * limit + 1, to: Math.min(page * limit, total), total })}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              {tc("back")}
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              {tc("next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
