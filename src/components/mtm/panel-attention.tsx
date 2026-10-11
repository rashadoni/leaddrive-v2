"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowUpRight, BellRing, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createDateFormatter } from "@/lib/format-date"
import { fetchOperationalWeekJsonWithTimeout } from "@/lib/mtm/operational-week-client"
import {
  MTM_PANEL_ATTENTION_KINDS,
  attentionItemHref,
  nextWorkdayHref,
  type MtmPanelAttention as Attention,
  type MtmPanelAttentionItem,
  type MtmPanelAttentionKind,
  type MtmPanelNextWorkday,
} from "@/lib/mtm/panel-attention"

/**
 * «Ждёт решения» — the first thing on the Panel (owner 2026-10-11).
 *
 * Rows, not tiles: the audit of 2026-09-21 removed the zero counters from
 * this screen, and a row here exists only while something waits. With nothing
 * waiting the block is not drawn at all — no «всё разобрано».
 */

const KINDS = new Set<string>(MTM_PANEL_ATTENTION_KINDS)
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
/** The last answer per scope, for the tab's lifetime: reopening the Panel must not push the team list down a second later. */
const CACHE_KEY = "mtm:week:attention"

const ACTION_KEY: Record<MtmPanelAttentionKind, "review" | "publish" | "resolve"> = {
  contactCreateRequests: "review",
  customerCreateRequests: "review",
  routeChangeRequests: "review",
  routesAwaitingPublish: "publish",
  olderAlerts: "resolve",
}
const DATE_HINT_KEY: Record<MtmPanelAttentionKind, "waitingSince" | "nearestDay" | "newestDay"> = {
  contactCreateRequests: "waitingSince",
  customerCreateRequests: "waitingSince",
  routeChangeRequests: "waitingSince",
  routesAwaitingPublish: "nearestDay",
  olderAlerts: "newestDay",
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dateKey(value: unknown): string | null {
  return typeof value === "string" && DATE_KEY.test(value) ? value : null
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

/** Reads the answer defensively: an open tab may meet a newer or an older server. */
export function normalizePanelAttention(value: unknown): Attention | null {
  const envelope = record(value)
  if (envelope.success !== true) return null
  const source = record(envelope.data)
  const today = dateKey(source.today)
  if (!today || !Array.isArray(source.items)) return null
  const items = source.items.flatMap((entry): MtmPanelAttentionItem[] => {
    const item = record(entry)
    const count = wholeNumber(item.count)
    if (typeof item.kind !== "string" || !KINDS.has(item.kind) || !count) return []
    return [{ kind: item.kind as MtmPanelAttentionKind, count, date: dateKey(item.date) }]
  })
  const next = record(source.nextWorkday)
  const nextDate = dateKey(next.date)
  const agents = wholeNumber(next.agents)
  const withoutRoute = wholeNumber(next.withoutRoute)
  const nextWorkday: MtmPanelNextWorkday | null = nextDate && agents !== null && withoutRoute !== null && withoutRoute <= agents
    ? { date: nextDate, agents, withoutRoute, agentId: typeof next.agentId === "string" && next.agentId ? next.agentId : null }
    : null
  return {
    timezone: typeof source.timezone === "string" ? source.timezone : "UTC",
    today,
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : "",
    items,
    nextWorkday,
  }
}

function readCached(scopeKey: string): Attention | null {
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_KEY}:${scopeKey}`)
    return raw ? normalizePanelAttention({ success: true, data: JSON.parse(raw) }) : null
  } catch {
    return null
  }
}

function remember(scopeKey: string, payload: Attention): void {
  try {
    window.sessionStorage.setItem(`${CACHE_KEY}:${scopeKey}`, JSON.stringify(payload))
  } catch {}
}

/** A calendar day as «8 окт.»: a date key is read at UTC so no timezone moves it. */
function dayLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? value : createDateFormatter(locale, { timeZone: "UTC", ...options }).format(date)
}

export function MtmPanelAttention({
  organizationId,
  viewerId,
  regionId,
  teamId,
  refreshToken,
}: {
  organizationId?: string | null
  viewerId?: string | null
  regionId: string
  teamId: string
  /** Bumped by the Panel's own refresh; the block follows it instead of polling by itself. */
  refreshToken: number
}) {
  const t = useTranslations("mtmDashboardPage.operationalWeek.attention")
  const locale = useLocale()
  const scopeKey = `${organizationId || "no-org"}:${viewerId || "no-viewer"}:${regionId}|${teamId}`
  const [result, setResult] = useState<{ scopeKey: string; data: Attention } | null>(null)
  const [failedScope, setFailedScope] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const cached = readCached(scopeKey)
    if (cached) setResult((current) => current?.scopeKey === scopeKey ? current : { scopeKey, data: cached })
    const params = new URLSearchParams()
    if (regionId) params.set("regionId", regionId)
    if (teamId) params.set("teamId", teamId)
    void (async () => {
      try {
        const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/week/attention?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const normalized = normalizePanelAttention(body)
        if (!normalized) throw new Error("Invalid attention response")
        if (requestId !== requestIdRef.current) return
        setResult({ scopeKey, data: normalized })
        setFailedScope(null)
        remember(scopeKey, normalized)
      } catch {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        setFailedScope(scopeKey)
      }
    })()
    return () => controller.abort()
  }, [organizationId, refreshToken, regionId, retry, scopeKey, teamId])

  // An answer for other filters is never shown under these ones.
  const data = result?.scopeKey === scopeKey ? result.data : null
  if (!data) {
    // A block that could not be read must not look like «nothing is waiting».
    return failedScope === scopeKey ? (
      <p role="alert" data-testid="mtm-panel-attention-error" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700 lg:px-5">
        <WifiOff className="h-4 w-4 text-red-600" aria-hidden="true" />
        <span className="font-semibold">{t("loadFailed")}</span>
        <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => setRetry((value) => value + 1)}>{t("retry")}</Button>
      </p>
    ) : null
  }

  const next = data.nextWorkday && data.nextWorkday.withoutRoute > 0 ? data.nextWorkday : null
  if (data.items.length === 0 && !next) return null

  const row = (key: string, text: string, hint: string | null, href: string, action: string) => (
    <li key={key} data-testid={`mtm-panel-attention-${key}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-2 dark:border-zinc-700 lg:px-5">
      <p className="min-w-0 text-sm">
        <span className="font-semibold">{text}</span>
        {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
      </p>
      <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0 md:min-h-0">
        <Link href={href} prefetch={false}>{action}<ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link>
      </Button>
    </li>
  )

  return (
    <section data-testid="mtm-panel-attention" aria-labelledby="mtm-panel-attention-title" className="border-b border-zinc-200 dark:border-zinc-700">
      <h3 id="mtm-panel-attention-title" className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/25 dark:text-amber-100 lg:px-5">
        <BellRing className="h-4 w-4" aria-hidden="true" />{t("title")}
      </h3>
      <ul>
        {data.items.map((item) => row(
          item.kind,
          t(item.kind, { count: item.count }),
          item.date ? t(DATE_HINT_KEY[item.kind], { date: dayLabel(item.date, locale, { day: "numeric", month: "short" }) }) : null,
          attentionItemHref(item),
          t(ACTION_KEY[item.kind]),
        ))}
        {next ? row(
          "next-workday",
          next.agents === 1
            ? t("nextWorkdaySingle", { date: dayLabel(next.date, locale, { weekday: "short", day: "numeric", month: "short" }) })
            : next.withoutRoute === next.agents
              ? t("nextWorkdayNobody", { date: dayLabel(next.date, locale, { weekday: "short", day: "numeric", month: "short" }), total: next.agents })
              : t("nextWorkdaySome", { date: dayLabel(next.date, locale, { weekday: "short", day: "numeric", month: "short" }), count: next.withoutRoute, total: next.agents }),
          null,
          nextWorkdayHref(next),
          t("plan"),
        ) : null}
      </ul>
    </section>
  )
}
