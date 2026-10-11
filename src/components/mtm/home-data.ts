"use client"

import { useEffect, useRef, useState } from "react"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { fetchOperationalWeekJsonWithTimeout } from "@/lib/mtm/operational-week-client"
import type { HomeWeekFacts } from "@/lib/mtm/home-dashboard"
import {
  MTM_PANEL_ATTENTION_KINDS,
  type MtmPanelAttention,
  type MtmPanelAttentionItem,
  type MtmPanelAttentionKind,
  type MtmPanelNextWorkday,
  type MtmPanelWeekDay,
} from "@/lib/mtm/panel-attention"

/**
 * What the MTM home screen reads besides today's team list: «ждёт решения»
 * and the week's facts. Both are read defensively — a tab left open may meet
 * a newer or an older server — and neither is shown under filters it was not
 * fetched for.
 */

const KINDS = new Set<string>(MTM_PANEL_ATTENTION_KINDS)
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
/** The last answer per scope, for the tab's lifetime: reopening the screen must not rearrange it a second later. */
const ATTENTION_CACHE_KEY = "mtm:home:attention"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dateKey(value: unknown): string | null {
  return typeof value === "string" && DATE_KEY.test(value) ? value : null
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

export function normalizeHomeAttention(value: unknown): MtmPanelAttention | null {
  const envelope = record(value)
  if (envelope.success !== true) return null
  const source = record(envelope.data)
  const today = dateKey(source.today)
  if (!today || !Array.isArray(source.items)) return null
  const items = source.items.flatMap((entry): MtmPanelAttentionItem[] => {
    const item = record(entry)
    const count = wholeNumber(item.count)
    if (typeof item.kind !== "string" || !KINDS.has(item.kind) || !count) return []
    const people = names(item.people)
    return [{
      kind: item.kind as MtmPanelAttentionKind,
      count,
      date: dateKey(item.date),
      people,
      peopleCount: Math.max(wholeNumber(item.peopleCount) ?? 0, people.length),
      types: (Array.isArray(item.types) ? item.types : []).flatMap((raw) => {
        const type = record(raw)
        const typeCount = wholeNumber(type.count)
        return typeof type.type === "string" && type.type && typeCount ? [{ type: type.type, count: typeCount }] : []
      }),
    }]
  })
  const next = record(source.nextWorkday)
  const nextDate = dateKey(next.date)
  const agents = wholeNumber(next.agents)
  const withoutRoute = wholeNumber(next.withoutRoute)
  const nextWorkday: MtmPanelNextWorkday | null = nextDate && agents !== null && withoutRoute !== null && withoutRoute <= agents
    ? { date: nextDate, agents, withoutRoute, agentId: typeof next.agentId === "string" && next.agentId ? next.agentId : null, people: names(next.people) }
    : null
  const week = (Array.isArray(source.week) ? source.week : []).flatMap((raw): MtmPanelWeekDay[] => {
    const day = record(raw)
    const date = dateKey(day.date)
    return date && typeof day.isWorkingDay === "boolean" ? [{ date, isWorkingDay: day.isWorkingDay }] : []
  })
  return {
    timezone: typeof source.timezone === "string" ? source.timezone : "UTC",
    today,
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : "",
    // Unknown is «working»: an old server must not paint every day a day off.
    todayIsWorkingDay: source.todayIsWorkingDay !== false,
    week: week.length === 7 ? week : [],
    items,
    nextWorkday,
  }
}

function readCachedAttention(scopeKey: string): MtmPanelAttention | null {
  try {
    const raw = window.sessionStorage.getItem(`${ATTENTION_CACHE_KEY}:${scopeKey}`)
    return raw ? normalizeHomeAttention({ success: true, data: JSON.parse(raw) }) : null
  } catch {
    return null
  }
}

function rememberAttention(scopeKey: string, payload: MtmPanelAttention): void {
  try {
    window.sessionStorage.setItem(`${ATTENTION_CACHE_KEY}:${scopeKey}`, JSON.stringify(payload))
  } catch {}
}

export interface HomeAttentionState {
  data: MtmPanelAttention | null
  /** The check failed and there is no earlier answer to show. */
  failed: boolean
  retry: () => void
}

export function useHomeAttention(input: {
  organizationId?: string | null
  viewerId?: string | null
  regionId: string
  teamId: string
  /** Bumped by the screen's own refresh; the block follows it instead of polling by itself. */
  refreshToken: number
}): HomeAttentionState {
  const { organizationId, viewerId, regionId, teamId, refreshToken } = input
  const scopeKey = `${organizationId || "no-org"}:${viewerId || "no-viewer"}:${regionId}|${teamId}`
  const [result, setResult] = useState<{ scopeKey: string; data: MtmPanelAttention } | null>(null)
  const [failedScope, setFailedScope] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const cached = readCachedAttention(scopeKey)
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
        const normalized = normalizeHomeAttention(body)
        if (!normalized) throw new Error("Invalid attention response")
        if (requestId !== requestIdRef.current) return
        setResult({ scopeKey, data: normalized })
        setFailedScope(null)
        rememberAttention(scopeKey, normalized)
      } catch {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        setFailedScope(scopeKey)
      }
    })()
    return () => controller.abort()
  }, [organizationId, refreshToken, regionId, retryToken, scopeKey, teamId])

  // An answer for other filters is never shown under these ones.
  const data = result?.scopeKey === scopeKey ? result.data : null
  return { data, failed: !data && failedScope === scopeKey, retry: () => setRetryToken((value) => value + 1) }
}

/** The plan points and visits of the registry's report, or null when the answer is not one. */
export function homeWeekFacts(value: unknown): HomeWeekFacts | null {
  const envelope = record(value)
  if (envelope.success !== true) return null
  const report = record(record(envelope.data).report)
  const drilldown = record(report.drilldown)
  if (!Array.isArray(drilldown.planDenominator) || !Array.isArray(drilldown.gpsDenominator)) return null
  const fact = (raw: unknown) => {
    const entry = record(raw)
    const date = dateKey(entry.date)
    return typeof entry.agentId === "string" && entry.agentId && date ? { agentId: entry.agentId, date, entry } : null
  }
  return {
    planPoints: drilldown.planDenominator.flatMap((raw) => {
      const found = fact(raw)
      return found ? [{ agentId: found.agentId, date: found.date, completed: found.entry.completed === true }] : []
    }),
    visits: drilldown.gpsDenominator.flatMap((raw) => {
      const found = fact(raw)
      return found ? [{ agentId: found.agentId, date: found.date, gpsConfirmed: found.entry.gpsConfirmed === true }] : []
    }),
  }
}

/** Planned and visited stops of a period, straight from the report's totals. */
export function homePlanTotals(value: unknown): { planned: number; done: number } | null {
  const envelope = record(value)
  if (envelope.success !== true) return null
  const plan = record(record(record(envelope.data).report).plan)
  const planned = wholeNumber(plan.denominator)
  const done = wholeNumber(plan.numerator)
  return planned === null || done === null ? null : { planned, done }
}

export interface HomeWeekState {
  /** This week's facts; null while loading, when refused (an agent) or when the read failed. */
  facts: HomeWeekFacts | null
  /** The same days of last week; null when unknown. */
  previous: { planned: number; done: number } | null
  failed: boolean
  retry: () => void
}

/**
 * The week's facts from the endpoint «Результаты» reads, for Monday through
 * Sunday. Not polled: it is read again when today's live numbers move
 * (`liveKey`), so the strip never trails the figure above it by more than one
 * refresh of the team list.
 */
export function useHomeWeek(input: {
  organizationId?: string | null
  today: string | null
  teamId: string
  liveKey: string
}): HomeWeekState {
  const { organizationId, today, teamId, liveKey } = input
  const scopeKey = today && DATE_KEY.test(today) ? `${organizationId || ""}|${today}|${teamId}` : ""
  const [week, setWeek] = useState<{ scopeKey: string; facts: HomeWeekFacts } | null>(null)
  const [previous, setPrevious] = useState<{ scopeKey: string; totals: { planned: number; done: number } } | null>(null)
  const [failedScope, setFailedScope] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!scopeKey || !today) return
    const controller = new AbortController()
    const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7
    const monday = addDateKeyDays(today, -weekday)
    const params = new URLSearchParams({ visitType: "ALL", from: monday, to: addDateKeyDays(monday, 7) })
    if (teamId) params.set("teamId", teamId)
    fetch(`/api/v1/mtm/kpi?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
    })
      .then(async (response) => {
        // «Результаты» refuses an agent: their screen simply has no week strip.
        if (response.status === 403) return
        const facts = response.ok ? homeWeekFacts(await response.json()) : null
        if (!facts) throw new Error("week")
        setWeek({ scopeKey, facts })
        setFailedScope(null)
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return
        setFailedScope(scopeKey)
      })
    return () => controller.abort()
  }, [liveKey, organizationId, retryToken, scopeKey, teamId, today])

  useEffect(() => {
    if (!scopeKey || !today) return
    const controller = new AbortController()
    const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7
    const lastMonday = addDateKeyDays(today, -weekday - 7)
    // Monday through the same weekday, the end exclusive.
    const params = new URLSearchParams({ visitType: "ALL", from: lastMonday, to: addDateKeyDays(lastMonday, weekday + 1) })
    if (teamId) params.set("teamId", teamId)
    fetch(`/api/v1/mtm/kpi?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
    })
      .then(async (response) => {
        const totals = response.ok ? homePlanTotals(await response.json()) : null
        if (totals) setPrevious({ scopeKey, totals })
      })
      // A comparison that could not be read is simply not drawn.
      .catch(() => {})
    return () => controller.abort()
  }, [organizationId, scopeKey, teamId, today])

  const facts = week && week.scopeKey === scopeKey ? week.facts : null
  return {
    facts,
    previous: previous && previous.scopeKey === scopeKey ? previous.totals : null,
    failed: !facts && Boolean(scopeKey) && failedScope === scopeKey,
    retry: () => setRetryToken((value) => value + 1),
  }
}
