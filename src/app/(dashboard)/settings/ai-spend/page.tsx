"use client"

/**
 * «Настройки → ИИ и расходы» (owner, 2026-11-10, by the approved mockup):
 * what each service and each AI agent cost by day, week or month; whose key
 * each provider runs on; today's spend against the daily limit.
 *
 * Reads /api/v1/settings/ai-spend (the gateway's journal `ai_usage`) and
 * /api/v1/settings/ai-keys. Admins only — the server refuses everyone else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Hint } from "@/components/hint"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { aiFeatureLabel } from "@/lib/ai/gateway/features"
import type { SpendGranularity, SpendRange, SpendReport, SpendRow } from "@/lib/ai/gateway/spend-report"

const RANGES_FOR: Record<SpendGranularity, readonly SpendRange[]> = {
  day: ["7d", "30d", "90d"],
  week: ["30d", "90d", "12m"],
  month: ["90d", "12m"],
}
const DEFAULT_RANGE: Record<SpendGranularity, SpendRange> = { day: "30d", week: "90d", month: "12m" }

/** Fixed order: the most expensive service of the window takes the first colour. */
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
const OTHER_COLOR = "#9ca3af"
const OTHER = "__other"

type KeyRow = { provider: string; keyHint: string; status: string; lastCheckedAt: string | null }
type KeysState = { platformAllowed: boolean; keys: KeyRow[] }

const PROVIDER_ROWS = [
  { id: "anthropic", name: "Claude", vendor: "Anthropic", uses: "usesAnthropic", selfKey: true },
  { id: "gemini", name: "Gemini", vendor: "Google", uses: "usesGemini", selfKey: false },
  { id: "openai", name: "OpenAI", vendor: "", uses: "usesOpenai", selfKey: false },
  { id: "voyage", name: "Voyage", vendor: "", uses: "usesVoyage", selfKey: false },
  { id: "google", name: "Google Cloud", vendor: "", uses: "usesGoogle", selfKey: false },
] as const

function intlLocale(locale: string) {
  return locale === "az" ? "az-Latn-AZ" : locale === "en" ? "en-US" : "ru-RU"
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function modelLabel(provider: string, model: string | null) {
  const claude = model?.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/)
  if (claude) return `Claude · ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`
  const name = PROVIDER_ROWS.find((p) => p.id === provider)?.name ?? provider
  return model ? `${name} · ${model}` : name
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export default function AiSpendPage() {
  const t = useTranslations("aiSpend")
  const locale = useLocale()
  const nf = intlLocale(locale)
  const [granularity, setGranularity] = useState<SpendGranularity>("week")
  const [range, setRange] = useState<SpendRange>("90d")
  const [report, setReport] = useState<SpendReport | null>(null)
  const [keys, setKeys] = useState<KeysState | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading")
  const tz = useMemo(() => browserTimeZone(), [])

  const money = useCallback((value: number) => {
    if (value > 0 && value < 0.01) return `< ${new Intl.NumberFormat(nf, { style: "currency", currency: "USD" }).format(0.01)}`
    return new Intl.NumberFormat(nf, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  }, [nf])
  const count = useCallback((value: number) => new Intl.NumberFormat(nf).format(value), [nf])
  const tokens = useCallback((value: number) => {
    if (value >= 1_000_000) return t("tokensM", { n: new Intl.NumberFormat(nf, { maximumFractionDigits: 2 }).format(value / 1_000_000) })
    if (value >= 1_000) return t("tokensK", { n: new Intl.NumberFormat(nf, { maximumFractionDigits: 0 }).format(value / 1_000) })
    return count(value)
  }, [count, nf, t])

  useEffect(() => {
    const ac = new AbortController()
    fetch(`/api/v1/settings/ai-spend?granularity=${granularity}&range=${range}&tz=${encodeURIComponent(tz)}`, { signal: ac.signal })
      .then(async (res) => {
        if (res.status === 403) return setState("forbidden")
        if (!res.ok) return setState("error")
        setReport((await res.json()).data)
        setState("ready")
      })
      .catch(() => { if (!ac.signal.aborted) setState("error") })
    return () => ac.abort()
  }, [granularity, range, tz])

  useEffect(() => {
    const ac = new AbortController()
    fetch("/api/v1/settings/ai-keys", { signal: ac.signal })
      .then(async (res) => { if (res.ok) setKeys((await res.json()).data) })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const chooseGranularity = (next: SpendGranularity) => {
    setGranularity(next)
    if (!RANGES_FOR[next].includes(range)) setRange(DEFAULT_RANGE[next])
  }

  if (state === "forbidden") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{t("adminOnly")}</div>
      </div>
    )
  }

  const exportHref = `/api/v1/settings/ai-spend/export?granularity=${granularity}&range=${range}&tz=${encodeURIComponent(tz)}&lang=${locale}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <a href={exportHref} download className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted">
          {t("export")}
        </a>
      </div>

      {state === "error" && !report && (
        <div className="rounded-xl border border-border border-l-4 border-l-red-500 bg-card p-4 text-sm">{t("loadError")}</div>
      )}

      {report && <Kpis report={report} money={money} count={count} nf={nf} t={t} locale={locale} />}

      <section className="rounded-xl border border-border bg-card" data-testid="ai-spend-report">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 pt-4">
          <div className="flex gap-6 text-sm" role="tablist">
            {(["day", "week", "month"] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={granularity === g}
                onClick={() => chooseGranularity(g)}
                className={granularity === g ? "border-b-2 border-primary pb-3 font-semibold" : "border-b-2 border-transparent pb-3 text-muted-foreground hover:text-foreground"}
              >
                {t(g === "day" ? "byDay" : g === "week" ? "byWeek" : "byMonth")}
              </button>
            ))}
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("periodLabel")}</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as SpendRange)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm font-semibold"
            >
              {RANGES_FOR[granularity].map((r) => <option key={r} value={r}>{t(`range${r}`)}</option>)}
            </select>
          </label>
        </div>
        {report ? <Report report={report} money={money} count={count} tokens={tokens} nf={nf} t={t} locale={locale} /> : (
          <div className="h-80 animate-pulse" />
        )}
      </section>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <KeysCard keys={keys} onChange={setKeys} t={t} nf={nf} />
        <LimitCard report={report} keys={keys} money={money} nf={nf} t={t} />
      </div>
    </div>
  )
}

type T = ReturnType<typeof useTranslations>

function Kpis({ report, money, count, nf, t, locale }: { report: SpendReport; money: (v: number) => string; count: (v: number) => string; nf: string; t: T; locale: string }) {
  const day = (iso: string) => new Intl.DateTimeFormat(nf, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
  const byFeature = new Map<string, number>()
  for (const row of report.rows) byFeature.set(row.feature, (byFeature.get(row.feature) ?? 0) + row.costUsd)
  const [topFeature, topCost] = [...byFeature.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  const share = report.totals.costUsd > 0 ? Math.round((topCost / report.totals.costUsd) * 100) : 0
  // Average over the days that had a journal: before the first call in the
  // window there was nothing to count, not a zero.
  const firstDay = report.firstCallAt && report.firstCallAt.slice(0, 10) > report.firstDay ? report.firstCallAt.slice(0, 10) : report.firstDay
  const days = report.firstCallAt ? Math.max(1, Math.round((Date.parse(report.lastDay) - Date.parse(firstDay)) / 86_400_000) + 1) : 0
  const average = days ? report.totals.costUsd / days : 0
  const todayShare = report.today.limit > 0 ? Math.min(100, (report.today.spent / report.today.limit) * 100) : 0
  const tile = "rounded-xl border border-border bg-card p-4"
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div className={tile}>
        <div className="text-xs font-medium text-muted-foreground">{t("kpiPeriod")}</div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{money(report.totals.costUsd)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{t("kpiPeriodSub", { from: day(report.firstDay), to: day(report.lastDay), calls: count(report.totals.calls) })}</div>
      </div>
      <div className={tile}>
        <div className="text-xs font-medium text-muted-foreground">{t("kpiToday")}</div>
        <div className="mt-2 text-2xl font-bold tabular-nums">
          {money(report.today.spent)} <span className="text-sm font-medium text-muted-foreground">{t("kpiTodayOf", { limit: money(report.today.limit) })}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${todayShare >= 100 ? "bg-red-500" : todayShare >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(todayShare, report.today.spent > 0 ? 2 : 0)}%` }} />
        </div>
      </div>
      <div className={tile}>
        <div className="text-xs font-medium text-muted-foreground">{t("kpiTop")}</div>
        <div className="mt-2 truncate text-2xl font-bold">{topFeature ? aiFeatureLabel(topFeature, locale) : "—"}</div>
        {topFeature && <div className="mt-1 text-[11px] text-muted-foreground">{t("kpiTopSub", { cost: money(topCost), share })}</div>}
      </div>
      <div className={tile}>
        <div className="text-xs font-medium text-muted-foreground">{t("kpiAverage")}</div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{money(average)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{t("kpiAverageSub", { month: money(average * 30) })}</div>
      </div>
    </div>
  )
}

type Series = { id: string; label: string; color: string }

function Report({ report, money, count, tokens, nf, t, locale }: {
  report: SpendReport; money: (v: number) => string; count: (v: number) => string; tokens: (v: number) => string; nf: string; t: T; locale: string
}) {
  const byFeature = new Map<string, number>()
  for (const row of report.rows) byFeature.set(row.feature, (byFeature.get(row.feature) ?? 0) + row.costUsd)
  const ranked = [...byFeature.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  // At most four services by name; a fifth and later fold into «Остальное».
  const named = ranked.length > SERIES_COLORS.length ? ranked.slice(0, SERIES_COLORS.length - 1) : ranked
  const series: Series[] = named.map((f, i) => ({ id: f, label: aiFeatureLabel(f, locale), color: SERIES_COLORS[i] }))
  if (ranked.length > named.length) series.push({ id: OTHER, label: t("other"), color: OTHER_COLOR })
  const colorOf = (feature: string) => series.find((s) => s.id === feature)?.color ?? OTHER_COLOR

  const periodLabel = (iso: string, long = false) => {
    const d = new Date(`${iso}T00:00:00Z`)
    if (report.granularity === "month") return new Intl.DateTimeFormat(nf, { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(d)
    const f = new Intl.DateTimeFormat(nf, { day: "numeric", month: "short", timeZone: "UTC" })
    if (report.granularity === "day") return f.format(d)
    const end = new Date(d.getTime() + 6 * 86_400_000)
    return `${f.format(d)} – ${f.format(end)}`
  }

  const empty = report.totals.calls === 0
  const chartTitle = t(report.granularity === "day" ? "chartTitleDay" : report.granularity === "week" ? "chartTitleWeek" : "chartTitleMonth")

  return (
    <>
      <div className="px-6 pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{chartTitle}</h2>
          {series.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {series.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
              ))}
            </div>
          )}
        </div>
        {empty ? (
          <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center">
            <div className="text-sm font-medium">{t("empty")}</div>
            <div className="text-xs text-muted-foreground">{t("journalSince")}</div>
          </div>
        ) : (
          <Chart report={report} series={series} money={money} periodLabel={periodLabel} />
        )}
      </div>

      {!empty && (
        <div className="overflow-x-auto px-6 pb-5 pt-2">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2.5 font-medium">{t("colService")}</th>
                <th className="py-2.5 font-medium">{t("colAgent")}</th>
                <th className="py-2.5 font-medium">{t("colProvider")}</th>
                <th className="py-2.5 text-right font-medium">{t("colCalls")}</th>
                <th className="py-2.5 text-right font-medium">{t("colTokens")}</th>
                <th className="py-2.5 pl-6 font-medium">{t("colKey")}</th>
                <th className="py-2.5 text-right font-medium">{t("colCost")}</th>
                <th className="w-44 py-2.5 pl-6 font-medium">{t("colShare")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.rows.map((row: SpendRow, i) => {
                const share = report.totals.costUsd > 0 ? (row.costUsd / report.totals.costUsd) * 100 : 0
                const color = colorOf(row.feature)
                return (
                  <tr key={`${row.feature}|${row.agentId}|${row.provider}|${row.model}|${row.keySource}|${i}`} className="border-b border-border/60">
                    <td className="py-2.5"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: color }} />{aiFeatureLabel(row.feature, locale)}</td>
                    <td className={row.agentName ? "" : "text-muted-foreground"}>{row.agentName ?? "—"}</td>
                    <td>{modelLabel(row.provider, row.model)}</td>
                    <td className="text-right">{count(row.calls)}</td>
                    <td className="text-right text-muted-foreground">{tokens(row.inputTokens)} / {tokens(row.outputTokens)}</td>
                    <td className="pl-6">{row.keySource === "tenant" ? t("keyTenant") : t("keyPlatform")}</td>
                    <td className="text-right font-semibold">{money(row.costUsd)}</td>
                    <td className="pl-6">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(share, row.costUsd > 0 ? 0.6 : 0)}%`, background: color }} /></div>
                        <span className="w-10 text-right text-xs">{new Intl.NumberFormat(nf, { maximumFractionDigits: share < 1 ? 1 : 0 }).format(share)} %</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="font-semibold">
                <td className="py-2.5">{t("total")}</td><td /><td />
                <td className="text-right">{count(report.totals.calls)}</td><td /><td />
                <td className="text-right">{money(report.totals.costUsd)}</td><td />
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">{t("journalSince")}</p>
        </div>
      )}
    </>
  )
}

function Chart({ report, series, money, periodLabel }: {
  report: SpendReport; series: Series[]; money: (v: number) => string; periodLabel: (iso: string, long?: boolean) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 250, L = 48, B = 28, T = 22
  const W = Math.max(width, 320)
  const named = new Set(series.map((s) => s.id))
  const stacks = report.periods.map((p) => {
    const parts = series.map((s) => ({
      ...s,
      value: s.id === "__other"
        ? Object.entries(p.byFeature).filter(([f]) => !named.has(f)).reduce((sum, [, v]) => sum + v, 0)
        : p.byFeature[s.id] ?? 0,
    }))
    return { period: p.period, total: p.costUsd, parts }
  })
  const peak = Math.max(...stacks.map((s) => s.total), 0)
  const step = niceStep(peak)
  const max = Math.max(step, Math.ceil(peak / step) * step)
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const slot = (W - L) / Math.max(stacks.length, 1)
  const bw = Math.max(3, Math.min(72, slot * 0.6))
  const labelEvery = Math.max(1, Math.ceil(stacks.length / 12))
  const showTotals = stacks.length <= 16
  const tick = (v: number) => (step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : String(v))

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={W} height={H} role="img" aria-label="chart" className="block text-[11px]">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeDasharray={v ? "2 4" : undefined} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fill="hsl(var(--muted-foreground))">{tick(v)}</text>
            </g>
          ))}
          {stacks.map((s, i) => {
            const cx = L + slot * i + slot / 2
            let acc = 0
            const parts = s.parts.filter((p) => p.value > 0)
            return (
              <g key={s.period}>
                {parts.map((p, k) => {
                  const y0 = y(acc)
                  const y1 = y(acc + p.value)
                  acc += p.value
                  const top = k === parts.length - 1
                  const r = Math.min(4, bw / 2, y0 - y1)
                  return (
                    <g key={p.id}>
                      {top
                        ? <path d={`M${cx - bw / 2},${y0} V${y1 + r} q0,-${r} ${r},-${r} H${cx + bw / 2 - r} q${r},0 ${r},${r} V${y0} Z`} fill={p.color} />
                        : <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} fill={p.color} />}
                      {k > 0 && <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y0} y2={y0} stroke="hsl(var(--card))" strokeWidth={2} />}
                    </g>
                  )
                })}
                {showTotals && s.total > 0 && (
                  <text x={cx} y={y(s.total) - 7} textAnchor="middle" fontWeight={600} fill="hsl(var(--foreground))">{money(s.total)}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" fill="hsl(var(--muted-foreground))">{periodLabel(s.period)}</text>
                )}
                <rect
                  x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`${periodLabel(s.period, true)}: ${money(s.total)}`}
                />
              </g>
            )
          })}
        </svg>
      )}
      {hover !== null && stacks[hover] && (
        <div
          className="pointer-events-none absolute top-6 z-10 w-64 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(L + slot * hover + slot / 2 + bw / 2 + 8, W - 264) }}
        >
          <div className="mb-1 font-semibold">{periodLabel(stacks[hover].period, true)} · {money(stacks[hover].total)}</div>
          {stacks[hover].parts.map((p) => (
            <div key={p.id} className="flex justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5"><i className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} /><span className="truncate">{p.label}</span></span>
              <span className="tabular-nums">{money(p.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A round step for the y-axis: 1, 2 or 5 times a power of ten, about five lines. */
function niceStep(peak: number) {
  if (peak <= 0) return 1
  const raw = peak / 5
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

function KeysCard({ keys, onChange, t, nf }: { keys: KeysState | null; onChange: (k: KeysState) => void; t: T; nf: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmRemove, setConfirmRemove] = useState(false)
  const own = keys?.keys.find((k) => k.provider === "anthropic") ?? null
  const platformAllowed = keys?.platformAllowed !== false

  async function save() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/v1/settings/ai-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", key: value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = json?.code
        setError(t(code === "KEY_REFUSED" ? "keyRefused" : code === "KEY_MALFORMED" ? "keyMalformed" : code === "PROVIDER_UNREACHABLE" ? "keyUnreachable" : "keySaveFailed"))
        return
      }
      onChange(json.data)
      setEditing(false)
      setValue("")
    } catch {
      setError(t("keySaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const res = await fetch("/api/v1/settings/ai-keys?provider=anthropic", { method: "DELETE" })
    if (!res.ok) throw new Error(t("keySaveFailed"))
    onChange((await res.json()).data)
  }

  const date = (iso: string | null) => iso ? new Intl.DateTimeFormat(nf, { day: "numeric", month: "short" }).format(new Date(iso)) : ""

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold">{t("keysTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("keysSubtitle")}</p>
      <div className="mt-4 divide-y divide-border/60">
        {PROVIDER_ROWS.map((p) => {
          const isOwn = p.selfKey && own
          const off = p.selfKey && !own && !platformAllowed
          return (
            <div key={p.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:flex-nowrap">
                <div className="min-w-0 sm:flex-1">
                  <div className="text-sm font-semibold">{p.name}{p.vendor && <span className="font-normal text-muted-foreground"> · {p.vendor}</span>}</div>
                  <div className="text-xs text-muted-foreground">{t(p.uses)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {isOwn ? (
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                      <i className="h-2 w-2 rounded-full bg-sky-500" />{t("statusOwn", { hint: own.keyHint })}
                      {own.lastCheckedAt && <span className="text-muted-foreground">· {t("checkedAt", { date: date(own.lastCheckedAt) })}</span>}
                    </span>
                  ) : off ? (
                    <Hint text={t("statusOffHint")}>
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-red-600 dark:text-red-400" tabIndex={0}><i className="h-2 w-2 rounded-full bg-red-500" />{t("statusOff")}</span>
                    </Hint>
                  ) : (
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><i className="h-2 w-2 rounded-full bg-emerald-500" />{t("statusPlatform")}</span>
                  )}
                  {p.selfKey ? (
                    !editing && (
                      <>
                        <button type="button" onClick={() => { setEditing(true); setError("") }} className="h-8 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
                          {t(own ? "replaceKey" : "enterKey")}
                        </button>
                        {own && (
                          <button type="button" onClick={() => setConfirmRemove(true)} className="h-8 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium text-red-600 hover:bg-muted dark:text-red-400">
                            {t("removeKey")}
                          </button>
                        )}
                      </>
                    )
                  ) : (
                    <Hint text={t("keyLaterHint")}>
                      <span className="whitespace-nowrap text-xs text-muted-foreground underline decoration-dotted underline-offset-4" tabIndex={0}>{t("keyLater")}</span>
                    </Hint>
                  )}
                </div>
              </div>
              {p.selfKey && editing && (
                <div className="mt-3 space-y-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={t("keyPlaceholder")}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm"
                    aria-label={t("keyPlaceholder")}
                  />
                  {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={save} disabled={saving || value.trim().length === 0} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                      {saving ? t("keySaving") : t("keySave")}
                    </button>
                    <button type="button" onClick={() => { setEditing(false); setValue(""); setError("") }} className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-auto pt-3 text-[11px] text-muted-foreground">{t("keysFooter")}</p>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        onConfirm={remove}
        title={t("removeTitle")}
        description={t(platformAllowed ? "removeDescPlatform" : "removeDescOff")}
        confirmLabel={t("removeKey")}
      />
    </section>
  )
}

function LimitCard({ report, keys, money, nf, t }: { report: SpendReport | null; keys: KeysState | null; money: (v: number) => string; nf: string; t: T }) {
  const today = report?.today
  const share = today && today.limit > 0 ? Math.min(100, (today.spent / today.limit) * 100) : 0
  const over = Boolean(today && today.spent >= today.limit)
  // The day is counted in UTC; say when it turns over on the viewer's clock
  // (the UTC midnight after the report's last local day).
  const reset = report
    ? new Intl.DateTimeFormat(nf, { hour: "2-digit", minute: "2-digit" }).format(new Date(Date.parse(`${report.lastDay}T00:00:00Z`) + 86_400_000))
    : ""
  const ownClaude = keys?.keys.some((k) => k.provider === "anthropic")
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold">{t("limitTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("limitSubtitle")}</p>
      <div className="mt-6 flex items-end justify-between">
        <div><div className="text-xs text-muted-foreground">{t("limitSpent")}</div><div className="text-3xl font-bold tabular-nums">{today ? money(today.spent) : "—"}</div></div>
        <div className="text-right"><div className="text-xs text-muted-foreground">{t("limitPerDay")}</div><div className="text-3xl font-bold tabular-nums">{today ? money(today.limit) : "—"}</div></div>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : share >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(share, today && today.spent > 0 ? 1.5 : 0)}%` }} />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
        <span>{t("limitShare", { share: new Intl.NumberFormat(nf, { maximumFractionDigits: 0 }).format(share) })}</span>
        <span>{t("limitReset", { time: reset })}</span>
      </div>
      <div className={`mt-6 rounded-lg border border-border border-l-4 p-4 text-sm ${over ? "border-l-red-500" : "border-l-amber-500"}`}>
        <div className="font-semibold">{t(over ? "limitOverTitle" : "limitWhenTitle")}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t("limitWhenBody")}</div>
      </div>
      <div className="mt-4 rounded-lg border border-border border-l-4 border-l-sky-500 p-4 text-sm">
        {ownClaude ? (
          <div className="text-xs">{t("ownKeyActive")}</div>
        ) : (
          <>
            <div className="font-semibold">{t("ownKeyTitle")}</div>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              <li>• {t("ownKey1")}</li>
              <li>• {t("ownKey2")}</li>
              <li>• {t("ownKey3")}</li>
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
