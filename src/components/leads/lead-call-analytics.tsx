"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  CheckSquare,
  ChevronDown,
  Frown,
  Info,
  Laugh,
  Meh,
  MessageSquare,
  Smile,
  Target,
  TrendingDown,
} from "lucide-react"
import { CollapsibleSection } from "@/components/crm/collapsible-section"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"

type Sentiment = "very_positive" | "positive" | "neutral" | "negative" | "very_negative"

interface LeadCallInsight {
  sentiment: Sentiment
  summary: string
  topics: string[]
  actionItems: Array<{
    text: string
    owner: "agent" | "customer" | null
    dueDateHint: string | null
  }>
  competitorMentions: Array<{
    name: string
    context: string
    count: number
  }>
  coachingHints: Array<{
    rule: string
    message: string
    severity: "info" | "warning" | "critical"
  }>
}

interface LeadCall {
  id: string
  direction: "inbound" | "outbound"
  durationSeconds: number | null
  analysedAt: string
  insight: LeadCallInsight
}

interface LeadCallAnalyticsResponse {
  success: boolean
  data?: {
    calls: LeadCall[]
    hasMore: boolean
  }
}

const INITIAL_VISIBLE = 3

function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—"
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60
  return `${minutes}:${String(remainder).padStart(2, "0")}`
}

function SentimentIcon({ sentiment }: { sentiment: Sentiment }) {
  const className = "h-5 w-5 shrink-0"
  if (sentiment === "very_positive") return <Laugh className={cn(className, "text-green-600")} />
  if (sentiment === "positive") return <Smile className={cn(className, "text-emerald-600")} />
  if (sentiment === "neutral") return <Meh className={cn(className, "text-slate-500")} />
  if (sentiment === "negative") return <Frown className={cn(className, "text-amber-600")} />
  return <TrendingDown className={cn(className, "text-red-600")} />
}

function AnalyticsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} aria-live="polite" role="status" className="space-y-3 py-1">
      {[0, 1].map((row) => (
        <div key={row} className="animate-pulse space-y-2 border-b pb-3 last:border-b-0">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-3/4 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function LeadCallAnalytics({
  leadId,
  organizationId,
}: {
  leadId: string
  organizationId?: string
}) {
  const t = useTranslations("slice2.conversationInsights")
  const locale = useLocale()
  const [calls, setCalls] = useState<LeadCall[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestVersionRef = useRef(0)

  const sentimentLabels = useMemo<Record<Sentiment, string>>(() => ({
    very_positive: t("sentimentVeryPositive"),
    positive: t("sentimentPositive"),
    neutral: t("sentimentNeutral"),
    negative: t("sentimentNegative"),
    very_negative: t("sentimentVeryNegative"),
  }), [t])

  const load = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError(false)
    try {
      const headers = organizationId ? { "x-organization-id": organizationId } : undefined
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(leadId)}/call-insights`, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as LeadCallAnalyticsResponse
      if (!payload.success || !payload.data) throw new Error("Invalid response")
      if (requestVersion !== requestVersionRef.current) return
      setCalls(payload.data.calls)
      setHasMore(payload.data.hasMore)
      setExpandedId(payload.data.calls[0]?.id ?? null)
      setShowAll(false)
    } catch {
      if (requestVersion !== requestVersionRef.current) return
      setError(true)
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [leadId, organizationId])

  useEffect(() => {
    void load()
    return () => {
      requestVersionRef.current += 1
    }
  }, [load])

  const visibleCalls = showAll ? calls : calls.slice(0, INITIAL_VISIBLE)

  return (
    <CollapsibleSection title={t("leadSectionTitle")}>
      {loading ? <AnalyticsSkeleton label={t("leadLoading")} /> : null}

      {!loading && error ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{t("leadLoadError")}</span>
          </div>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !error && calls.length === 0 ? (
        <div className="flex items-start gap-3 py-2">
          <Brain aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("leadEmptyTitle")}</p>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("leadEmptyDesc")}</p>
          </div>
        </div>
      ) : null}

      {!loading && !error && calls.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {visibleCalls.map((call) => {
              const expanded = expandedId === call.id
              const directionLabel = call.direction === "outbound"
                ? t("directionOutbound")
                : t("directionInbound")
              return (
                <article key={call.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`lead-call-insight-${call.id}`}
                    onClick={() => setExpandedId(expanded ? null : call.id)}
                    className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {call.direction === "outbound" ? (
                        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                      ) : (
                        <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{directionLabel}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={call.analysedAt}>{formatDateTime(call.analysedAt, locale)}</time>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{durationLabel(call.durationSeconds)}</span>
                        </div>
                        <p className={cn("mt-1 break-words text-sm leading-relaxed", !expanded && "line-clamp-2")}>
                          {call.insight.summary}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2" title={sentimentLabels[call.insight.sentiment]}>
                      <span className="sr-only">{sentimentLabels[call.insight.sentiment]}</span>
                      <span aria-hidden="true" className="hidden text-xs text-muted-foreground sm:inline">
                        {sentimentLabels[call.insight.sentiment]}
                      </span>
                      <span aria-hidden="true"><SentimentIcon sentiment={call.insight.sentiment} /></span>
                      <ChevronDown aria-hidden="true" className={cn("h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none", !expanded && "-rotate-90")} />
                    </div>
                  </button>

                  {expanded ? (
                    <div id={`lead-call-insight-${call.id}`} className="space-y-4 border-t bg-muted/20 px-4 py-4 text-sm">
                      {call.insight.topics.length > 0 ? (
                        <section>
                          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" /> {t("topics")}
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {call.insight.topics.map((topic, index) => (
                              <span key={`${topic}-${index}`} className="rounded-full bg-background px-2.5 py-1 text-xs ring-1 ring-inset ring-border">
                                {topic}
                              </span>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {call.insight.actionItems.length > 0 ? (
                        <section>
                          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <CheckSquare aria-hidden="true" className="h-3.5 w-3.5" /> {t("actionItemsHeader")}
                          </h4>
                          <ul className="space-y-2">
                            {call.insight.actionItems.map((item, index) => (
                              <li key={`${item.text}-${index}`} className="flex items-start gap-2 break-words leading-relaxed">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                                <span>
                                  {item.text}
                                  {item.owner ? (
                                    <span className="text-muted-foreground"> · {t(item.owner === "agent" ? "ownerAgent" : "ownerCustomer")}</span>
                                  ) : null}
                                  {item.dueDateHint ? <span className="text-muted-foreground"> · {item.dueDateHint}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      {call.insight.competitorMentions.length > 0 ? (
                        <section>
                          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <Target aria-hidden="true" className="h-3.5 w-3.5" /> {t("competitorMentions")}
                          </h4>
                          <ul className="space-y-1.5">
                            {call.insight.competitorMentions.map((mention, index) => (
                              <li key={`${mention.name}-${index}`} className="break-words leading-relaxed">
                                <span className="font-medium">{mention.name}</span>
                                {mention.context ? <span className="text-muted-foreground"> — {mention.context}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      {call.insight.coachingHints.length > 0 ? (
                        <section>
                          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <Brain aria-hidden="true" className="h-3.5 w-3.5" /> {t("coachingHints")}
                          </h4>
                          <ul className="space-y-2">
                            {call.insight.coachingHints.map((hint, index) => (
                              <li key={`${hint.rule}-${index}`} className="flex min-w-0 items-start gap-2 break-words leading-relaxed">
                                {hint.severity === "critical" ? (
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                                ) : hint.severity === "warning" ? (
                                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                ) : (
                                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                                )}
                                <span>{hint.message}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          {calls.length > INITIAL_VISIBLE ? (
            <div className="border-t px-4 py-2 text-center">
              <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setShowAll((value) => !value)}>
                {showAll ? t("leadShowLess") : t("leadShowMore", { count: calls.length - INITIAL_VISIBLE })}
              </Button>
            </div>
          ) : null}

          {hasMore && showAll ? (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("leadRecentOnly")}</p>
          ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
  )
}
