"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts"

interface AnalyticsData {
  summary: {
    totalSent: number
    totalResponses: number
    responseRate: number | null
    nps: number | null
    avgScore: number | null
    promoters: number
    passives: number
    detractors: number
  }
  channels: { channel: string; count: number }[]
  commentSentiment?: { positive: number; neutral: number; negative: number; unknown: number }
  trend: { day: string; total: number; promoters: number; passives: number; detractors: number; avgScore: number | null; nps: number | null }[]
  topWords: { word: string; count: number }[]
}

interface Props {
  surveyId: string
  orgId: string | number | undefined
}

export function SurveyAnalyticsDashboard({ surveyId, orgId }: Props) {
  const t = useTranslations("surveys")
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [range, setRange] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    const headers = { "x-organization-id": String(orgId) }
    fetch(`/api/v1/surveys/${surveyId}/analytics?days=${range}`, { headers })
      .then(r => r.json())
      .then(res => { if (res.success) setData(res.data) })
      .finally(() => setLoading(false))
  }, [surveyId, orgId, range])

  if (loading) return <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 animate-pulse h-64" />
  if (!data) return null

  const { summary, trend, channels, topWords } = data
  const sentimentPie = [
    { name: t("promoters"), value: summary.promoters, fill: "#10b981" },
    { name: t("passives"), value: summary.passives, fill: "#f59e0b" },
    { name: t("detractors"), value: summary.detractors, fill: "#ef4444" },
  ].filter(d => d.value > 0)

  const npsColor = summary.nps === null ? "text-muted-foreground" : summary.nps >= 50 ? "text-emerald-500" : summary.nps >= 0 ? "text-amber-500" : "text-red-500"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("analytics")}</h3>
        <div className="flex items-center gap-1 text-xs">
          {[7, 30, 90, 365].map(d => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-2.5 py-1 rounded-md border ${range === d ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
            >
              {d === 365 ? "1y" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label={t("nps")} value={summary.nps !== null ? String(summary.nps) : "—"} className={npsColor} />
        <Tile label={t("avgScore")} value={summary.avgScore !== null ? String(summary.avgScore) : "—"} />
        <Tile label={t("responses")} value={String(summary.totalResponses)} />
        <Tile label={t("sent")} value={String(summary.totalSent)} />
        <Tile label={t("responseRate")} value={summary.responseRate !== null ? `${summary.responseRate}%` : "—"} />
      </div>

      {summary.totalResponses === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
          {t("noResponsesInRange", { days: range })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("responsesOverTime")}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={false} name={t("allLabel")} />
                <Line type="monotone" dataKey="detractors" stroke="#ef4444" strokeWidth={1.5} dot={false} name={t("detractorsLine")} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("npsDistribution")}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={sentimentPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {sentimentPie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("npsTrend")}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend.filter(t => t.nps !== null)}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} domain={[-100, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="nps" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} name={t("nps")} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("channels")}</h4>
            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noChannelData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={channels} layout="vertical" margin={{ left: 40, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="channel" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {data.commentSentiment && (data.commentSentiment.positive + data.commentSentiment.neutral + data.commentSentiment.negative + data.commentSentiment.unknown) > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 md:col-span-2">
              <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("commentSentimentAI")}</h4>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div className="text-center">
                  <p className="text-xl font-bold text-emerald-600">{data.commentSentiment.positive}</p>
                  <p className="text-xs text-muted-foreground">{t("positive")}</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-muted-foreground">{data.commentSentiment.neutral}</p>
                  <p className="text-xs text-muted-foreground">{t("neutral")}</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-red-600">{data.commentSentiment.negative}</p>
                  <p className="text-xs text-muted-foreground">{t("negative")}</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-muted-foreground/60">{data.commentSentiment.unknown}</p>
                  <p className="text-xs text-muted-foreground">{t("pending")}</p>
                </div>
              </div>
            </div>
          )}

          {topWords.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 md:col-span-2">
              <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("topWords")}</h4>
              <div className="flex flex-wrap gap-2">
                {topWords.map(t => {
                  const size = Math.min(16, 10 + Math.log2(t.count) * 2)
                  return (
                    <span key={t.word} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-1" style={{ fontSize: `${size}px` }}>
                      <span className="font-medium">{t.word}</span>
                      <span className="text-muted-foreground tabular-nums text-[11px]">· {t.count}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3">
      <p className={`text-2xl font-bold tabular-nums ${className}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}
