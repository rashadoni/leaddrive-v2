"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HelpButton } from "@/components/help/help-button"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts"
import {
  Sparkles, Users, TrendingUp, TrendingDown, MessageSquare, Tag, RefreshCw, Download, List,
} from "lucide-react"

// Segment Insights for Contacts only. The leads toggle was removed — leads
// have their own analytics under /leads, and mixing both entities in one
// dashboard confused customers who expected /contacts to be about contacts.
interface ContactsAgg {
  total: number
  active: number
  withBrand: number
  withCategory: number
  avgEngagement: number
  growth: { last30: number; prev30: number; pct: number | null }
  byCategory: Array<{ category: string; count: number }>
  bySource: Array<{ source: string; count: number }>
  topBrands: Array<{ brand: string; count: number }>
  sms: { everReceived: number; last30: number; last90: number; coverage: number }
  weekly: Array<{ week: string; count: number }>
  engagementByCategory: Array<{ category: string; avg_score: number; count: number }>
}

const CATEGORY_COLORS: Record<string, string> = {
  vip: "#a855f7",
  partner: "#14b8a6",
  prospect: "#f59e0b",
  regular: "#3b82f6",
  inactive: "#94a3b8",
  "(none)": "#cbd5e1",
}

const SOURCE_COLORS = ["#3b82f6", "#22c55e", "#f97316", "#6366f1", "#a855f7", "#14b8a6", "#ec4899", "#94a3b8"]

export default function InsightsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
  const t = useTranslations("insights")
  const locale = useLocale()
  const entityLabel = t("contacts")
  const entitySingular = entityLabel.replace(/s$|ы$|лар$/i, "")

  const categoryLabel = (v: string): string => {
    const k = String(v || "").toLowerCase()
    const map: Record<string, string> = { vip: "catVip", regular: "catRegular", partner: "catPartner", prospect: "catProspect", inactive: "catInactive", "(none)": "catNone" }
    return map[k] ? t(map[k]) : v
  }
  const sourceLabel = (v: string): string => {
    const k = String(v || "").toLowerCase()
    const map: Record<string, string> = {
      website: "srcWebsite", referral: "srcReferral", cold_call: "srcColdCall", linkedin: "srcLinkedin",
      email: "srcEmail", sms: "srcSms", social: "srcSocial", event: "srcEvent", other: "srcOther",
      outlook_eml: "srcOutlook", "(none)": "srcNone",
    }
    return map[k] ? t(map[k]) : v
  }
  const [data, setData] = useState<ContactsAgg | null>(null)
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState<string[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)

  const load = (refresh = false) => {
    setLoading(true)
    fetch(`/api/v1/analytics/segments?entity=contacts${refresh ? "&refresh=1" : ""}`, { headers })
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const fetchInsights = async () => {
    if (!data) return
    setInsightsLoading(true)
    setInsights([])
    try {
      const res = await fetch("/api/v1/analytics/segments/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ entity: "contacts", aggregate: data, locale }),
      })
      const json = await res.json()
      if (json.success) setInsights(json.data.insights || [])
    } finally {
      setInsightsLoading(false)
    }
  }

  const drillTo = (filter: string) => {
    router.push(`/contacts?${filter}`)
  }

  const exportCsv = () => {
    if (!data) return
    const rows: string[] = []
    rows.push("type,key,count")
    for (const r of data.byCategory) rows.push(`category,${r.category},${r.count}`)
    for (const r of data.bySource) rows.push(`source,${r.source},${r.count}`)
    for (const r of data.topBrands) rows.push(`brand,${r.brand},${r.count}`)
    const blob = new Blob([rows.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `contacts-segments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const weeklyFormatted = useMemo(() => {
    return (data?.weekly || []).map(w => ({
      week: formatDate(w.week, locale, { month: "short", day: "numeric" }),
      count: w.count,
    }))
  }, [data, locale])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="contacts" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push(`/contacts`)} className="gap-1.5">
          <List className="h-4 w-4" /> {t("contactList")}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(true)} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> {t("csv")}
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="animate-pulse space-y-3">
          <div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="grid grid-cols-2 gap-3"><div className="h-72 bg-muted rounded-lg" /><div className="h-72 bg-muted rounded-lg" /></div>
        </div>
      ) : (
        <>
          {/* SMS attribution + Engagement — pinned to the very top */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-600" /> {t("smsAttribution")}
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md bg-muted p-3">
                  <p className="text-2xl font-bold">{data.sms.everReceived}</p>
                  <p className="text-[11px] text-muted-foreground">{t("smsEver")}</p>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <p className="text-2xl font-bold">{data.sms.last30}</p>
                  <p className="text-[11px] text-muted-foreground">{t("smsLast30")}</p>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <p className="text-2xl font-bold">{data.sms.last90}</p>
                  <p className="text-[11px] text-muted-foreground">{t("smsLast90")}</p>
                </div>
              </div>
              <div className="mt-3 h-2 bg-muted rounded overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${data.sms.coverage}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("smsCoveragePct", { pct: data.sms.coverage })}
              </p>
              {data.sms.everReceived === 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                  {t.rich("smsNone", { link: () => <code className="bg-muted px-1 rounded">/campaigns</code> })}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">{t("engagementByCategory")}</h2>
              <div className="space-y-2">
                {data.engagementByCategory.map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] w-24 justify-center">{categoryLabel(r.category)}</Badge>
                    <div className="flex-1 h-3 bg-muted rounded overflow-hidden relative">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.min(100, r.avg_score)}%`,
                          backgroundColor: CATEGORY_COLORS[r.category] || "#cbd5e1",
                        }}
                      />
                    </div>
                    <span className="text-xs tabular-nums w-10 text-right font-medium">{r.avg_score}</span>
                    <span className="text-[10px] text-muted-foreground w-16 text-right">({r.count})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile icon={Users} label={t("statTotal", { entity: entityLabel })} value={data.total} />
            <StatTile
              icon={data.growth.pct == null || data.growth.pct >= 0 ? TrendingUp : TrendingDown}
              label={t("statNew30d")}
              value={data.growth.last30}
              sub={data.growth.pct == null ? "—" : t("statNew30dSub", { pct: (data.growth.pct >= 0 ? "+" : "") + data.growth.pct })}
              subColor={data.growth.pct == null ? "text-muted-foreground" : data.growth.pct >= 0 ? "text-green-600" : "text-red-500"}
            />
            <StatTile
              icon={Tag}
              label={t("statWithBrand")}
              value={data.withBrand ?? data.topBrands.length}
              sub={t("statWithBrandSub", { count: data.topBrands.length })}
            />
            <StatTile
              icon={MessageSquare}
              label={t("statSmsCoverage")}
              value={`${data.sms.coverage}%`}
              sub={`${data.sms.everReceived} / ${data.total}`}
            />
          </div>

          {/* AI insights */}
          <div className="rounded-lg border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-violet-700 dark:text-violet-300">
                <Sparkles className="h-4 w-4" /> {t("aiTitle")}
              </h2>
              <Button variant="outline" size="sm" onClick={fetchInsights} disabled={insightsLoading}>
                {insightsLoading ? t("aiAnalyzing") : insights.length ? t("aiRegenerate") : t("aiGenerate")}
              </Button>
            </div>
            {insights.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {insights.map((ln, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-violet-500">•</span>
                    <span>{ln}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t("aiPlaceholder")}</p>
            )}
          </div>

          {/* Category + Source */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">{t("byCategory")}</h2>
              {(() => {
                const categorized = data.byCategory.filter(r => r.category && r.category !== "(none)")
                const noneRow = data.byCategory.find(r => r.category === "(none)")
                const categorizedTotal = categorized.reduce((s, r) => s + r.count, 0)
                if (categorized.length === 0) {
                  return (
                    <div className="py-10 text-center space-y-2">
                      <p className="text-sm text-muted-foreground">{t("noCategoriesTitle", { entity: entityLabel.toLowerCase() })}</p>
                      <p className="text-xs text-muted-foreground">{t("noCategoriesHint", { singular: entitySingular.toLowerCase() })}</p>
                    </div>
                  )
                }
                return (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={categorized.map(r => ({ ...r, label: categoryLabel(r.category) }))}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={(e: any) => `${e.label} (${e.count})`}
                          onClick={(e: any) => e?.category && drillTo(`category=${e.category}`)}
                        >
                          {categorized.map((r, i) => (
                            <Cell key={i} fill={CATEGORY_COLORS[r.category] || "#cbd5e1"} style={{ cursor: "pointer" }} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <p className="text-[11px] text-muted-foreground text-center mt-1">
                      {t("showingCategorized", { shown: categorizedTotal, entity: entityLabel.toLowerCase() })}
                      {noneRow ? ` · ${t("withoutCategory", { count: noneRow.count })}` : ""}
                    </p>
                  </>
                )
              })()}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">{t("bySource")}</h2>
              {(() => {
                const sourced = data.bySource.filter(r => r.source && r.source !== "(none)")
                const noneRow = data.bySource.find(r => r.source === "(none)")
                if (sourced.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground py-10 text-center">
                      {t("noSources", { entity: entityLabel.toLowerCase() })}
                    </p>
                  )
                }
                return (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={sourced.map(r => ({ ...r, label: sourceLabel(r.source) }))}>
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" onClick={(e: any) => e?.source && drillTo(`source=${e.source}`)}>
                          {sourced.map((_r, i) => (
                            <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} style={{ cursor: "pointer" }} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="text-[11px] text-muted-foreground text-center mt-1">
                      {t("showingSourced", { shown: sourced.reduce((s, r) => s + r.count, 0), entity: entityLabel.toLowerCase() })}
                      {noneRow ? ` · ${t("withoutSource", { count: noneRow.count })}` : ""}
                    </p>
                  </>
                )
              })()}
            </div>
          </div>

          {/* Top brands + Weekly timeseries */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">{t("topBrands")}</h2>
              {data.topBrands.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">{t("noBrands")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(240, data.topBrands.length * 30)}>
                  <BarChart data={data.topBrands} layout="vertical" margin={{ left: 40 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="brand" type="category" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="#6366f1"
                      style={{ cursor: "pointer" }}
                      onClick={(e: any) => e?.brand && drillTo(`search=${encodeURIComponent(e.brand)}`)}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">{t("weeklyTitle", { entity: entityLabel.toLowerCase() })}</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={weeklyFormatted}>
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </>
      )}
    </div>
  )
}

function StatTile({ icon: Icon, label, value, sub, subColor }: { icon: any; label: string; value: number | string; sub?: string; subColor?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
    </div>
  )
}
