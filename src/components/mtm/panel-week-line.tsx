"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowUpRight } from "lucide-react"
import { agentPeriodPreset } from "@/components/mtm/agent-period-view"

/**
 * One line of «Результаты» on the Panel: this week's plan against fact.
 *
 * It is the number the Results tab shows for «Эта неделя», read from the same
 * endpoint with the same range (`agentPeriodPreset("thisWeek")`), and it links
 * to that tab opened on that period — there is one calculation, and the Panel
 * only points at it. No tile, no percentage of its own: the audit of
 * 2026-09-21 took the counters off this screen.
 *
 * Silent when it has nothing to say (no plan and no visits this week) and when
 * the reader may not open Results (an agent gets 403 there).
 */

type WeekFacts = { planned: number; done: number; visits: number }

function nextDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

/** The three numbers of the registry's report, or null when the answer is not one. */
export function panelWeekFacts(value: unknown): WeekFacts | null {
  if (!value || typeof value !== "object") return null
  const envelope = value as { success?: unknown; data?: { report?: { plan?: { numerator?: unknown; denominator?: unknown }; gps?: { denominator?: unknown } } | null } }
  const report = envelope.success === true ? envelope.data?.report : null
  const planned = count(report?.plan?.denominator)
  const done = count(report?.plan?.numerator)
  const visits = count(report?.gps?.denominator)
  return planned === null || done === null || visits === null ? null : { planned, done, visits }
}

export function MtmPanelWeekLine({
  organizationId,
  today,
  regionId,
  teamId,
}: {
  organizationId?: string | null
  /** The tenant-local today the team list was built for. */
  today: string
  regionId: string
  teamId: string
}) {
  const t = useTranslations("mtmDashboardPage.operationalWeek.week")
  // Results filters by team, not by region: under a region alone the two
  // numbers would answer different questions, so the line is not drawn.
  const comparable = /^\d{4}-\d{2}-\d{2}$/.test(today) && !(regionId && !teamId)
  const requestKey = comparable ? `${organizationId || ""}|${today}|${teamId}` : ""
  const [result, setResult] = useState<{ key: string; facts: WeekFacts } | null>(null)

  useEffect(() => {
    if (!requestKey) return
    const controller = new AbortController()
    const range = agentPeriodPreset("thisWeek", today)
    const params = new URLSearchParams({ visitType: "ALL", from: range.from, to: nextDay(range.to) })
    if (teamId) params.set("teamId", teamId)
    fetch(`/api/v1/mtm/kpi?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const facts = panelWeekFacts(body)
        if (facts) setResult({ key: requestKey, facts })
      })
      // The line is a pointer to a page that reports its own failures.
      .catch(() => {})
    return () => controller.abort()
  }, [organizationId, requestKey, teamId, today])

  const facts = result && result.key === requestKey ? result.facts : null
  if (!facts || (facts.planned === 0 && facts.visits === 0)) return null

  return (
    <p data-testid="mtm-panel-week-line" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-2.5 text-sm dark:border-zinc-700 lg:px-5">
      <span>{facts.planned > 0 ? t("plan", { done: facts.done, planned: facts.planned }) : t("unplanned", { count: facts.visits })}</span>
      <Link href="/mtm/analytics?period=thisWeek" prefetch={false} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline md:min-h-0">
        {t("openResults")}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </p>
  )
}
