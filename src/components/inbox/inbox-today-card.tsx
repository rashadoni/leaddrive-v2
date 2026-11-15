"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import { Hint } from "@/components/hint"
import { formatReplyDuration, localDayStart, todayCardModel, type TodayCardModel } from "@/lib/inbox/dense-inbox"

/**
 * «Bu gün» at the foot of the inbox's folder rail (owner-approved mock-up,
 * 2026-11-15): incoming messages today, the change against yesterday up to the
 * same hour, seven days of bars and the usual time to a first reply.
 *
 * Read from the inbox reports the analytics page already uses — nothing new is
 * counted for it. The mock-up said «128 söhbət»; the reports count messages,
 * not conversations, so the card says «gələn mesaj» (owner, 2026-11-15:
 * «Давай» to that list). Seven days without a single incoming message draw no
 * card at all, and a day without a first reply draws no reply line: nothing
 * here is a zero standing in for «not counted».
 */

type Envelope<T> = { success?: boolean; data?: T }
type Temporal = { trend?: { date: string; inbound: number; outbound: number }[] }
type Frt = { answered?: number; medianMinutes?: number | null }

const REFRESH_MS = 5 * 60 * 1000

export function InboxTodayCard({ headers }: { headers: Record<string, string> }) {
  const t = useTranslations("inboxV2")
  const locale = useLocale()
  const [model, setModel] = useState<TodayCardModel | null>(null)
  const orgHeader = headers["x-organization-id"] ?? ""

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const now = Date.now()
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""
      const zone = tz ? `&tz=${encodeURIComponent(tz)}` : ""
      const requestHeaders: Record<string, string> = orgHeader ? { "x-organization-id": orgHeader } : {}
      const get = async <T,>(url: string): Promise<T | null> => {
        try {
          const res = await fetch(url, { headers: requestHeaders })
          if (!res.ok) return null
          const json = await readJsonSafely<Envelope<T>>(res)
          return json?.success && json.data && typeof json.data === "object" ? json.data : null
        } catch {
          return null
        }
      }
      const weekFrom = localDayStart(now, -6).toISOString()
      const yesterdayFrom = localDayStart(now, -1).toISOString()
      const yesterdayTo = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      const todayFrom = localDayStart(now, 0).toISOString()
      const [week, yesterday, frt] = await Promise.all([
        get<Temporal>(`/api/v1/inbox/analytics/temporal?from=${encodeURIComponent(weekFrom)}${zone}`),
        get<Temporal>(`/api/v1/inbox/analytics/temporal?from=${encodeURIComponent(yesterdayFrom)}&to=${encodeURIComponent(yesterdayTo)}${zone}`),
        get<Frt>(`/api/v1/inbox/analytics/frt?from=${encodeURIComponent(todayFrom)}`),
      ])
      if (cancelled) return
      if (!week || !Array.isArray(week.trend)) {
        setModel(null)
        return
      }
      const yesterdaySoFar = yesterday && Array.isArray(yesterday.trend)
        ? yesterday.trend.reduce((sum, row) => sum + (Number(row.inbound) || 0), 0)
        : null
      setModel(todayCardModel({
        nowMs: now,
        trend: week.trend,
        yesterdaySoFar,
        firstReply: frt && typeof frt.answered === "number"
          ? { answered: frt.answered, medianMinutes: typeof frt.medianMinutes === "number" ? frt.medianMinutes : null }
          : null,
      }))
    }
    // Once when the inbox opens, then every five minutes while somebody can see the tab.
    void load()
    const stop = startVisibleInterval(() => { void load() }, REFRESH_MS)
    return () => { cancelled = true; stop() }
  }, [orgHeader])

  if (!model) return null
  const peak = Math.max(1, ...model.bars.map((b) => b.value))
  const reply = model.medianFirstReplyMinutes != null
    ? formatReplyDuration(model.medianFirstReplyMinutes, {
        hoursMinutes: (h, m) => t("todayCardHoursMinutes", { h, m }),
        minutesSeconds: (m, s) => t("todayCardMinutesSeconds", { m, s }),
        seconds: (s) => t("todayCardSeconds", { s }),
      })
    : null

  return (
    <section
      data-testid="inbox-today-card"
      aria-label={t("todayCardTitle")}
      className="mx-2 mb-2 shrink-0 rounded-xl border border-border/70 bg-background px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
        <span>{t("todayCardTitle")}</span>
        {model.deltaPct != null && (
          <Hint text={t("todayCardDeltaHint")} side="top" align="end">
            <span
              data-testid="inbox-today-delta"
              className={cn(
                "inline-flex items-center gap-0.5 tabular-nums font-semibold",
                model.deltaPct > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {model.deltaPct > 0 ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : model.deltaPct < 0 ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : null}
              {Math.abs(model.deltaPct)}%
            </span>
          </Hint>
        )}
      </div>
      <Hint text={t("todayCardCountHint")} side="top" align="start">
        <div className="mt-0.5 flex items-baseline gap-1.5" data-testid="inbox-today-count">
          <span className="text-2xl font-bold tabular-nums leading-none text-foreground">{model.today}</span>
          <span className="text-xs text-muted-foreground">{t("todayCardUnit", { count: model.today })}</span>
        </div>
      </Hint>
      <div className="mt-2 flex h-9 items-end gap-1" data-testid="inbox-today-bars">
        {model.bars.map((bar, i) => {
          const isToday = i === model.bars.length - 1
          const [y, m, d] = bar.day.split("-").map(Number)
          const label = `${formatDate(new Date(y, m - 1, d, 12), locale, { day: "numeric", month: "long" })}: ${bar.value}`
          return (
            <span
              key={bar.day}
              title={label}
              aria-label={label}
              role="img"
              className={cn("flex-1 rounded-sm", isToday ? "bg-primary" : "bg-muted-foreground/25")}
              style={{ height: `${Math.max(6, Math.round((bar.value / peak) * 100))}%` }}
            />
          )
        })}
      </div>
      {reply && (
        <Hint text={t("todayCardReplyHint")} side="top" align="start">
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px]" data-testid="inbox-today-reply">
            <span className="text-muted-foreground">{t("todayCardReply")}</span>
            <span className="font-semibold tabular-nums text-foreground">{reply}</span>
          </div>
        </Hint>
      )}
    </section>
  )
}
