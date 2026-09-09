"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts"
import { AlertTriangle } from "lucide-react"

interface AnalyticsData {
  range: { days: number; since: string; until: string }
  totals: { mentions: number; engagement: number; reach: number }
  sentiment: { positive: number; neutral: number; negative: number }
  status: Record<string, number>
  timeseries: { day: string; total: number; positive: number; neutral: number; negative: number; engagement: number }[]
  topPlatforms: { platform: string; count: number }[]
  topTerms: { term: string; count: number }[]
  topAuthors: { handle: string; name: string | null; count: number; platform: string }[]
  negativeSpike: { today: number; avg7d: number } | null
  surfaces?: { posts: number; comments: number; replies?: number; other: number }
  commentsBreakdown?: {
    total: number
    sentiment: { positive: number; neutral: number; negative: number }
    byPlatform: { platform: string; count: number }[]
  }
  operationalRollups?: {
    surfaces: { posts: number; comments: number; replies: number; other: number }
    surfaceByPlatform: Array<{ platform: string; posts: number; comments: number; replies: number; other: number }>
    providerCosts: Array<{
      providerKey: string
      phase: string
      runCount: number
      receivedCount: number
      acceptedCount: number
      reviewCount: number
      rejectedCount: number
      chargeUsd: number
      costPerAcceptedUsd: number | null
    }>
    providerTotals: { chargeUsd: number; acceptedCount: number; receivedCount: number }
    coverage: Array<{
      platform: string
      capability: string
      acquisitionMode: string
      adapterKey: string
      status: string
      routeCount: number
    }>
  }
}

const SENTIMENT_COLORS = {
  positive: "#10b981",
  neutral: "#6b7280",
  negative: "#ef4444",
}

const PLATFORM_COLORS: Record<string, string> = {
  twitter: "#1da1f2",
  instagram: "#e1306c",
  facebook: "#1877f2",
  telegram: "#0088cc",
  vkontakte: "#0077ff",
  youtube: "#ff0000",
  tiktok: "#010101",
}

interface Props {
  orgId: string | number | undefined
  days?: number
}

export function SocialAnalyticsPanel({ orgId, days = 30 }: Props) {
  const t = useTranslations("socialMonitoring")
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [range, setRange] = useState(days)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    const headers = { "x-organization-id": String(orgId) }
    fetch(`/api/v1/social/analytics?days=${range}`, { headers })
      .then(r => r.json())
      .then(res => {
        if (res.success) setData(res.data)
      })
      .finally(() => setLoading(false))
  }, [orgId, range])

  if (loading) {
    return <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 animate-pulse h-64" />
  }
  if (!data) return null

  const hasData = data.totals.mentions > 0
  const sentimentPie = [
    { name: "positive", value: data.sentiment.positive, fill: SENTIMENT_COLORS.positive },
    { name: "neutral", value: data.sentiment.neutral, fill: SENTIMENT_COLORS.neutral },
    { name: "negative", value: data.sentiment.negative, fill: SENTIMENT_COLORS.negative },
  ].filter(d => d.value > 0)

  return (
    <div className="space-y-4">
      {data.negativeSpike && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-3 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <span>
            <b>{t("negativeSpikeTitle")}</b> — {t("negativeSpikeMsg", { today: data.negativeSpike.today, avg: data.negativeSpike.avg7d })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("analytics")}</h3>
        <div className="flex items-center gap-1 text-xs">
          {[
            { v: 7, label: "7d" },
            { v: 30, label: "30d" },
            { v: 90, label: "90d" },
            { v: 365, label: "1y" },
            { v: 3650, label: "All" },
          ].map(({ v, label }) => (
            <button
              key={v}
              onClick={() => {
                setLoading(true)
                setRange(v)
              }}
              className={`px-2.5 py-1 rounded-md border ${range === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
          {t("noMentionsRange", { days: range })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("metricsOverTime")}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={false} name="All" />
                <Line type="monotone" dataKey="negative" stroke={SENTIMENT_COLORS.negative} strokeWidth={1.5} dot={false} name="Negative" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("sentimentLabel")}</h4>
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
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("topPlatforms")}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.topPlatforms} layout="vertical" margin={{ left: 40, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="platform" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.topPlatforms.map((p, i) => <Cell key={i} fill={PLATFORM_COLORS[p.platform] || "#6b7280"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("topAuthors")}</h4>
            {data.topAuthors.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noAuthorData")}</p>
            ) : (
              <ul className="space-y-1.5">
                {data.topAuthors.slice(0, 8).map(a => (
                  <li key={a.handle} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: PLATFORM_COLORS[a.platform] || "#6b7280" }} />
                      <span className="font-medium truncate">{a.name || a.handle}</span>
                      <span className="text-muted-foreground truncate">@{a.handle}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(data.operationalRollups?.surfaces || data.surfaces) && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 md:col-span-2">
              <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("analyticsSurfacesTitle")}</h4>
              {(() => {
                const surface = data.operationalRollups?.surfaces ?? { ...data.surfaces!, replies: data.surfaces?.replies ?? 0 }
                const posts = surface.posts
                const comments = surface.comments
                const replies = surface.replies
                const denominator = posts + comments + replies
                const commentsShare = denominator > 0 ? Math.round(((comments + replies) / denominator) * 100) : 0
                const cb = data.commentsBreakdown
                return (
                  <div className="space-y-3">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t("analyticsSurfacesTitle")}>
                      <div className="bg-blue-500" style={{ width: `${denominator > 0 ? (posts / denominator) * 100 : 0}%` }} />
                      <div className="bg-purple-500" style={{ width: `${denominator > 0 ? (comments / denominator) * 100 : 0}%` }} />
                      <div className="bg-fuchsia-500" style={{ width: `${denominator > 0 ? (replies / denominator) * 100 : 0}%` }} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />{t("surfaceFilters.posts")}: <b className="tabular-nums text-foreground">{posts}</b></span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-500" />{t("surfaceFilters.comments")}: <b className="tabular-nums text-foreground">{comments}</b></span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-fuchsia-500" />{t("analyticsReplies")}: <b className="tabular-nums text-foreground">{replies}</b></span>
                      <span>{t("commentsShare", { percent: commentsShare })}</span>
                    </div>
                    {cb && cb.total > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("analyticsCommentsSentiment")}:</span>
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLORS.positive }} /><span className="tabular-nums">{cb.sentiment.positive}</span></span>
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLORS.neutral }} /><span className="tabular-nums">{cb.sentiment.neutral}</span></span>
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLORS.negative }} /><span className="tabular-nums">{cb.sentiment.negative}</span></span>
                        <span className="ml-2">{t("analyticsCommentsByPlatform")}:</span>
                        {cb.byPlatform.slice(0, 5).map(p => (
                          <span key={p.platform} className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ background: PLATFORM_COLORS[p.platform] || "#6b7280" }} />
                            {p.platform} <span className="tabular-nums">{p.count}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {data.operationalRollups && (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-card md:col-span-2 dark:border-zinc-700">
              <div className="flex flex-col gap-1 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700">
                <div>
                  <h4 className="text-xs font-semibold">{t("coverageCostTitle")}</h4>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("coverageCostHint")}</p>
                </div>
                <div className="flex gap-4 text-xs">
                  <span><b className="tabular-nums">${data.operationalRollups.providerTotals.chargeUsd.toFixed(2)}</b> <span className="text-muted-foreground">{t("providerSpend")}</span></span>
                  <span><b className="tabular-nums">{data.operationalRollups.providerTotals.acceptedCount}</b> <span className="text-muted-foreground">{t("acceptedResults")}</span></span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t("platformLabel")}</th>
                      <th className="px-4 py-2 font-medium">{t("capabilityLabel")}</th>
                      <th className="px-4 py-2 font-medium">{t("adapterLabel")}</th>
                      <th className="px-4 py-2 font-medium">{t("acquisitionLabel")}</th>
                      <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {data.operationalRollups.coverage.map((row, index) => (
                      <tr key={`${row.platform}:${row.capability}:${row.adapterKey}:${index}`}>
                        <td className="px-4 py-2.5 font-medium">{row.platform}</td>
                        <td className="px-4 py-2.5">{row.capability}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px]">{row.adapterKey}</td>
                        <td className="px-4 py-2.5">{row.acquisitionMode}</td>
                        <td className="px-4 py-2.5"><span className={row.status === "ACTIVE" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{row.status}</span></td>
                      </tr>
                    ))}
                    {data.operationalRollups.coverage.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t("noCoverageRoutes")}</td></tr>}
                  </tbody>
                </table>
              </div>
              {data.operationalRollups.providerCosts.length > 0 && (
                <div className="border-t border-zinc-200 px-4 py-3 text-xs dark:border-zinc-700">
                  <div className="font-medium">{t("providerUnitCosts")}</div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
                    {data.operationalRollups.providerCosts.map(row => (
                      <span key={`${row.providerKey}:${row.phase}`}>
                        <b className="text-foreground">{row.providerKey}</b> · {row.phase} · ${row.chargeUsd.toFixed(2)} · {row.costPerAcceptedUsd === null ? t("noAcceptedCost") : t("perAccepted", { cost: row.costPerAcceptedUsd.toFixed(4) })}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {data.topTerms.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 md:col-span-2">
              <h4 className="text-xs font-semibold mb-3 text-muted-foreground">{t("topKeywords")}</h4>
              <div className="flex flex-wrap gap-2">
                {data.topTerms.map(t => (
                  <span key={t.term} className="inline-flex items-center gap-1.5 text-xs rounded-full border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-1">
                    <span className="font-medium">{t.term}</span>
                    <span className="text-muted-foreground tabular-nums">· {t.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
