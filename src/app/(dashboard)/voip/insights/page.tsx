"use client"

/**
 * A7 Conversation Intelligence — slice-2 UI.
 *
 * Recent VoIP calls + AI insights (sentiment, summary, topics, action
 * items, coaching hints) aggregated across the chosen window. Sales
 * managers see what competitors are mentioned most + what coaching
 * patterns repeat across the team.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  CheckSquare,
  Frown,
  Info,
  Laugh,
  Loader2,
  Meh,
  MessageSquare,
  Phone,
  Smile,
  Target,
  TrendingDown,
} from "lucide-react"

type Sentiment =
  | "very_positive"
  | "positive"
  | "neutral"
  | "negative"
  | "very_negative"

interface ActionItem {
  text: string
  owner: string | null
  dueDateHint: string | null
}

interface Competitor {
  name: string
  context: string
  count: number
}

interface Coaching {
  rule: string
  message: string
  severity: "info" | "warning" | "critical"
  count?: number
}

interface CallInsight {
  sentiment: Sentiment
  sentimentScore: number
  summary: string
  topics: string[]
  actionItemCount: number
  actionItems: ActionItem[]
  competitorMentions: Competitor[]
  coachingHints: Coaching[]
  costUsd: number | null
  latencyMs: number | null
  model: string | null
}

interface Call {
  id: string
  callSid: string | null
  direction: string
  fromNumber: string
  toNumber: string
  durationSeconds: number | null
  status: string
  disposition: string | null
  contactName: string | null
  contactId: string | null
  insightsAt: string | null
  createdAt: string
  insight: CallInsight | null
}

interface InsightsResponse {
  days: number
  periodStart: string
  periodEnd: string
  calls: Call[]
  totalCalls: number
  totalCallsWithInsights: number
  totalActionItems: number
  sentimentCounts: Record<Sentiment, number>
  competitorMentions: { name: string; count: number }[]
  coachingHints: Coaching[]
  truncated: boolean
  fetchCap: number
}

const SENTIMENT_ORDER: Sentiment[] = [
  "very_positive",
  "positive",
  "neutral",
  "negative",
  "very_negative",
]

const SENTIMENT_COLORS: Record<Sentiment, string> = {
  very_positive: "bg-green-500",
  positive: "bg-emerald-500",
  neutral: "bg-slate-400",
  negative: "bg-amber-500",
  very_negative: "bg-red-500",
}

function SentimentIcon({
  s,
  className,
}: {
  s: Sentiment
  className?: string
}) {
  const c = className ?? "w-5 h-5"
  if (s === "very_positive") return <Laugh className={`${c} text-green-600`} />
  if (s === "positive") return <Smile className={`${c} text-emerald-600`} />
  if (s === "neutral") return <Meh className={`${c} text-slate-500`} />
  if (s === "negative") return <Frown className={`${c} text-amber-600`} />
  return <TrendingDown className={`${c} text-red-600`} />
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function formatRelative(
  iso: string | null,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) {
    const minutes = Math.floor(ms / 60_000)
    return minutes < 1 ? t("relativeJustNow") : t("relativeMinutesAgo", { minutes })
  }
  if (hours < 24) return t("relativeHoursAgo", { hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t("relativeDaysAgo", { days })
  return t("relativeMonthsAgo", { months: Math.floor(days / 30) })
}

export default function ConversationInsightsPage() {
  const t = useTranslations("slice2.conversationInsights")
  const tc = useTranslations("slice2.common")
  const DAY_OPTIONS = [
    { key: 1, label: tc("today") },
    { key: 7, label: tc("last7d") },
    { key: 30, label: tc("last30d") },
    { key: 90, label: tc("last90d") },
  ]
  const SENTIMENT_LABELS: Record<Sentiment, string> = {
    very_positive: t("sentimentVeryPositive"),
    positive: t("sentimentPositive"),
    neutral: t("sentimentNeutral"),
    negative: t("sentimentNegative"),
    very_negative: t("sentimentVeryNegative"),
  }
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async (d: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/conversation-insights?days=${d}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(days)
  }, [days, loadData])

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="voip-insights" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setDays(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  days === opt.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && data.truncated && (
          <MotionCard className="mb-4 p-3 border border-amber-500 bg-amber-500/10 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            {t("truncatedBanner", { count: data.fetchCap })}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {t("kpiCallsAnalysed")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.totalCallsWithInsights}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckSquare className="w-3 h-3" /> {t("kpiActionItems")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.totalActionItems}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" /> {t("kpiCompetitorsNamed")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.competitorMentions.length}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> {t("kpiCoachingPatterns")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.coachingHints.length}
                </p>
              </MotionCard>
            </div>

            {/* Sentiment distribution bar */}
            {data.totalCalls > 0 && (
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg mb-4">
                <p className="text-sm font-medium mb-2">
                  {t("sentimentDistribution")}
                </p>
                <div className="flex h-3 rounded overflow-hidden mb-2">
                  {SENTIMENT_ORDER.map((s) => {
                    const count = data.sentimentCounts[s] ?? 0
                    const pct =
                      data.totalCalls > 0
                        ? (count / data.totalCalls) * 100
                        : 0
                    if (pct === 0) return null
                    return (
                      <div
                        key={s}
                        className={SENTIMENT_COLORS[s]}
                        style={{ width: `${pct}%` }}
                        title={`${SENTIMENT_LABELS[s]}: ${count}`}
                      />
                    )
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground flex-wrap gap-2">
                  {SENTIMENT_ORDER.map((s) => {
                    const count = data.sentimentCounts[s] ?? 0
                    if (count === 0) return null
                    return (
                      <span key={s} className="flex items-center gap-1">
                        <span
                          className={`w-2 h-2 rounded-full ${SENTIMENT_COLORS[s]}`}
                        />
                        {SENTIMENT_LABELS[s]}: {count}
                      </span>
                    )
                  })}
                </div>
              </MotionCard>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              {/* Competitor mentions */}
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4" /> {t("competitorMentions")}
                </h3>
                {data.competitorMentions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noCompetitors")}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {data.competitorMentions.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="font-mono text-muted-foreground">
                          {c.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </MotionCard>

              {/* Coaching patterns */}
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg lg:col-span-2">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4" /> {t("coachingPatterns")}
                </h3>
                {data.coachingHints.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noCoaching")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.coachingHints.map((h) => (
                      <div
                        key={h.rule}
                        className={`text-sm p-2 rounded border ${
                          h.severity === "critical"
                            ? "border-red-500 bg-red-500/5"
                            : h.severity === "warning"
                              ? "border-amber-500 bg-amber-500/5"
                              : "border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1">{h.message}</p>
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            ×{h.count ?? 1}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.has(`ruleLabels.${h.rule}`)
                            ? t(`ruleLabels.${h.rule}`)
                            : h.rule}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </MotionCard>
            </div>

            {/* Call list */}
            <h2 className="text-lg font-semibold mb-3">
              {t("recentCalls", { count: data.calls.length })}
            </h2>
            {data.calls.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1">{t("emptyDesc")}</p>
              </MotionCard>
            ) : (
              <div className="space-y-3">
                {data.calls.map((c) => {
                  const expanded = expandedId === c.id
                  return (
                    <MotionCard
                      key={c.id}
                      className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                    >
                      <button
                        onClick={() => setExpandedId(expanded ? null : c.id)}
                        className="w-full text-left flex items-start justify-between gap-3"
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {c.direction === "outbound" ? (
                            <ArrowUpRight className="w-4 h-4 text-blue-600 shrink-0 mt-1" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4 text-green-600 shrink-0 mt-1" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">
                              {c.contactName ??
                                (c.direction === "outbound"
                                  ? c.toNumber
                                  : c.fromNumber)}
                            </p>
                            {c.insight && (
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {c.insight.summary}
                              </p>
                            )}
                            <div className="text-xs text-muted-foreground mt-1 flex gap-2 flex-wrap">
                              <span>{formatDuration(c.durationSeconds)}</span>
                              <span>·</span>
                              <span>{formatRelative(c.insightsAt, t)}</span>
                              {c.insight && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {t("actionItems", { count: c.insight.actionItemCount })}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {c.insight && <SentimentIcon s={c.insight.sentiment} />}
                      </button>

                      {expanded && c.insight && (
                        <div className="mt-3 pt-3 border-t space-y-3 text-sm">
                          {c.insight.topics.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("topics")}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {c.insight.topics.map((topic, i) => (
                                  <span
                                    key={`${topic}-${i}`}
                                    className="px-2 py-0.5 rounded text-xs bg-muted"
                                  >
                                    {topic}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {c.insight.actionItems.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("actionItemsHeader")}
                              </p>
                              <ul className="space-y-1">
                                {c.insight.actionItems.map((a, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2"
                                  >
                                    <CheckSquare className="w-3 h-3 mt-1 text-muted-foreground shrink-0" />
                                    <span>
                                      {a.text}
                                      {a.owner && (
                                        <span className="text-muted-foreground">
                                          {" "}
                                          ({a.owner})
                                        </span>
                                      )}
                                      {a.dueDateHint && (
                                        <span className="text-muted-foreground">
                                          {" "}
                                          — {a.dueDateHint}
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {c.insight.competitorMentions.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("competitorMentions")}
                              </p>
                              <ul className="space-y-1">
                                {c.insight.competitorMentions.map((m, i) => (
                                  <li key={i} className="text-xs">
                                    <strong>{m.name}</strong>{" "}
                                    <span className="text-muted-foreground">
                                      ×{m.count} — {m.context}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {c.insight.coachingHints.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("coachingHints")}
                              </p>
                              <ul className="space-y-1">
                                {c.insight.coachingHints.map((h, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-xs"
                                  >
                                    {h.severity === "critical" ? (
                                      <AlertTriangle className="w-3 h-3 mt-0.5 text-red-600 shrink-0" />
                                    ) : h.severity === "warning" ? (
                                      <AlertCircle className="w-3 h-3 mt-0.5 text-amber-600 shrink-0" />
                                    ) : (
                                      <Info className="w-3 h-3 mt-0.5 text-blue-600 shrink-0" />
                                    )}
                                    <span>{h.message}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {c.insight.model && (
                            <p className="text-xs text-muted-foreground">
                              {t("modelLabel")}: {c.insight.model}
                              {c.insight.latencyMs !== null && (
                                <> · {Math.round(c.insight.latencyMs)}ms</>
                              )}
                              {c.insight.costUsd !== null && (
                                <>
                                  {" "}
                                  · ${Number(c.insight.costUsd ?? 0).toFixed(4)}
                                </>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </MotionCard>
                  )
                })}
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footer")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
