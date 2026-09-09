"use client"

/**
 * Drill-down CONTENT shown in the right-side Sheet drawer when an agent bubble or
 * table row is clicked: rank, headline KPI %, status, the per-domain metric
 * breakdown, AND the list of underlying completed work items behind the % (the
 * deals / tickets / tasks / projects / completed-MTM-tasks) fetched from
 * `/api/v1/leaderboard/agent-items` — this fills the drawer so the % is explained
 * by the actual work. Renders bare (no own border/close) — the Sheet supplies the
 * panel chrome + close button. Strings come from the `leaderboard` i18n namespace.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Clock } from "lucide-react"
import { attainmentColor } from "@/lib/leaderboard/colors"
import { AgentAvatar } from "@/components/leaderboard/agent-avatar"
import { Sparkline } from "@/components/leaderboard/sparkline"
import type { LeaderboardGroup, LeaderboardPeriod, MetricDetail, NormalizedAgent } from "@/lib/leaderboard/types"
import type { AgentItem, AgentItemsResult } from "@/lib/leaderboard/agent-items-types"

function formatValue(m: MetricDetail, currency: string | undefined, unit: (k: string) => string): string {
  switch (m.format) {
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "AZN",
        maximumFractionDigits: 0,
      }).format(m.value)
    case "percent":
      return `${m.value}%`
    case "minutes":
      return `${m.value} ${unit("min")}`
    case "days":
      return `${m.value} ${unit("days")}`
    default:
      return new Intl.NumberFormat().format(m.value)
  }
}

function formatItemValue(it: AgentItem): string {
  if (it.value == null) return ""
  if (it.valueFormat === "currency") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: it.currency || "AZN",
      maximumFractionDigits: 0,
    }).format(it.value)
  }
  return new Intl.NumberFormat().format(it.value)
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" })
function formatItemDate(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : DATE_FMT.format(d)
}

/** Which attainment label drives each group's % (mirrors the arena route META).
 *  The "why this %" line names this so the viewer knows WHICH metric the % measures. */
const ATT_KEY: Record<LeaderboardGroup, string> = {
  sales: "att.quota",
  mtm: "att.compliance",
  tickets: "att.sla",
  projects: "att.onTime",
  tasks: "att.onTime",
}

/** The numeric formula behind the % where it's a clean, WEIGHT-FREE computation:
 *  only sales = actual / quota. mtm is a per-org-WEIGHTED composite
 *  (cfg.mtmWeights), so we deliberately show NO fixed formula for it — a hardcoded
 *  0.5/0.3/0.2 would lie for an org that retuned the weights, and the drawer has
 *  no access to that org's weights — so mtm (like the rate-based projects/tasks/
 *  tickets) shows just the att-label, with its component rates already in the
 *  metric grid. Null when a metric is missing. Reads `agent.metrics` by key. */
function attainmentNumeric(agent: NormalizedAgent, group: LeaderboardGroup): string | null {
  if (group !== "sales") return null
  const v = (k: string) => agent.metrics.find((x) => x.key === k)?.value
  const a = v("actualAmount")
  const q = v("quotaAmount")
  if (a == null || q == null) return null
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: agent.currency || "AZN",
      maximumFractionDigits: 0,
    }).format(n)
  return `${fmt(a)} / ${fmt(q)}`
}

export function AgentDetailCard({
  agent,
  group,
  period,
  orgId,
}: {
  agent: NormalizedAgent
  group: LeaderboardGroup | null
  period: LeaderboardPeriod
  orgId?: string
}) {
  const t = useTranslations("leaderboard")
  const color = attainmentColor(agent.attainmentPct)
  // "Why this %": name the driving metric (+ a numeric actual/quota formula for sales).
  const attKey = group ? ATT_KEY[group] : null
  const attNumeric = group ? attainmentNumeric(agent, group) : null

  // The agent's underlying completed items (the "why this %" list). Re-fetches when
  // the drawer opens on a different agent / group / period. Any error degrades to
  // an empty list — the list is supplementary, never blocks the metric view.
  const [items, setItems] = useState<AgentItem[] | null>(null)
  const [itemsLabelKey, setItemsLabelKey] = useState<string | null>(null)
  const [itemsCapped, setItemsCapped] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  // Attainment-over-time for the sparkline (Phase-D hourly snapshots). Sparse on
  // cold start → the sparkline renders nothing until ≥2 points exist. Supplementary.
  const [history, setHistory] = useState<{ attainmentPct: number }[] | null>(null)

  useEffect(() => {
    if (!group || !orgId) return
    let cancelled = false
    setItemsLoading(true)
    setItems(null)
    setItemsLabelKey(null)
    setItemsCapped(false)
    fetch(`/api/v1/leaderboard/agent-items?group=${group}&agentId=${encodeURIComponent(agent.id)}&period=${period}`, {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => (r.ok ? (r.json() as Promise<AgentItemsResult>) : Promise.reject(r.status)))
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setItemsLabelKey(res.labelKey)
        setItemsCapped(res.capped)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agent.id, group, period, orgId])

  // Attainment history for the trend sparkline (window = 1 month). Period-agnostic
  // (the snapshot series spans calendar time, not the selected reporting window).
  useEffect(() => {
    if (!group || !orgId) return
    let cancelled = false
    setHistory(null)
    fetch(`/api/v1/leaderboard/history?group=${group}&agentId=${encodeURIComponent(agent.id)}&window=1m`, {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ points: { attainmentPct: number }[] }>) : Promise.reject(r.status)))
      .then((res) => {
        if (!cancelled) setHistory(res.points)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [agent.id, group, orgId])

  const trendDelta =
    history && history.length >= 2
      ? Math.round(history[history.length - 1].attainmentPct - history[0].attainmentPct)
      : 0

  return (
    <>
      <div className="flex items-center gap-3">
        <AgentAvatar src={agent.avatar} name={agent.name} ring={color.ring} fill={color.fill} size={48} />
        <div>
          <div className="font-semibold leading-tight text-primary">{agent.name}</div>
          <div className="text-xs text-muted-foreground">
            #{agent.rank} · {t(`status.${agent.status}`)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        {/* Plain foreground (near-black on the light panel) — matches the user's
            "text black" and is guaranteed readable at any attainment. The bubble's
            ring colour (hsl 75% 60%) washes out on white for amber/green, and a
            darkened hue still failed AA-large for yellow, so the status signal
            lives on the avatar ring + the "#rank · status" subtitle, not here. */}
        <span className="text-3xl font-bold text-foreground">{Math.round(agent.attainmentPct)}%</span>
        <span className="text-xs text-muted-foreground">{t("ofTarget")}</span>
      </div>

      {/* "Why this %" — names the driving metric (+ a numeric actual/quota
          formula for sales) so the headline number is explained, not just shown. */}
      {attKey && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{t(attKey)}</span>
          {attNumeric ? <span> · {attNumeric}</span> : null}
        </div>
      )}

      {/* Attainment trend (Phase-D snapshots) — hidden until ≥2 points exist
          (cold-start sparse). Delta = latest − first attainment over the window. */}
      {history && history.length >= 2 && (
        <div className="mt-2 flex items-center gap-2">
          <Sparkline values={history.map((p) => p.attainmentPct)} />
          <span className="text-xs text-muted-foreground">
            <span className={trendDelta >= 0 ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
              {trendDelta >= 0 ? "+" : ""}
              {trendDelta}
            </span>{" "}
            · {t("trend30d")}
          </span>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {agent.metrics.map((m) => (
          <div key={m.key} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t(`metrics.${m.key}`)}</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatValue(m, agent.currency, (k) => t(`units.${k}`))}
            </dd>
          </div>
        ))}
      </dl>

      {/* Completed work items behind the % — fills the drawer; supplementary, so
          loading/empty/error all degrade gracefully and never block the metrics. */}
      <div className="mt-5 border-t pt-4">
        {(itemsLabelKey || itemsLoading) && (
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
            {itemsLabelKey ? t(itemsLabelKey) : ""}
            {items && items.length > 0 ? ` · ${items.length}${itemsCapped ? "+" : ""}` : ""}
          </div>
        )}
        {itemsLoading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <ul className="max-h-[42vh] space-y-1 overflow-y-auto pr-1">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
              >
                <span className="truncate text-sm">{it.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {it.value != null && (
                    <span className="font-medium tabular-nums text-foreground">{formatItemValue(it)}</span>
                  )}
                  {it.onTime === true && (
                    <Check className="h-3.5 w-3.5 text-emerald-500" aria-label={t("items.onTime")} />
                  )}
                  {it.onTime === false && <Clock className="h-3.5 w-3.5 text-amber-500" aria-label={t("items.late")} />}
                  {it.date && <span className="tabular-nums">{formatItemDate(it.date)}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-2 text-xs text-muted-foreground">{t("items.empty")}</div>
        )}
      </div>
    </>
  )
}
