"use client"

import { Hint } from "@/components/hint"
import type { ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, BellRing, CalendarDays, CheckCircle2, Image as ImageIcon, MapPin, Route as RouteIcon, UserPlus, Building2, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HOME_ICON, type HomeTone } from "@/components/mtm/home-parts"
import type { HomeAttentionState } from "@/components/mtm/home-data"
import { createDateFormatter } from "@/lib/format-date"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { cn } from "@/lib/utils"
import {
  attentionItemHref,
  nextWorkdayHref,
  type MtmPanelAttention,
  type MtmPanelAttentionItem,
  type MtmPanelAttentionKind,
} from "@/lib/mtm/panel-attention"

/**
 * «Qərar gözləyir»: what waits for the manager, one row per list, each with
 * whose it is, since when, and a button that opens that list. A row exists
 * only while something waits.
 */

const ROW_KEY = {
  customerLocationRequests: "rowCustomerLocationRequests",
  attendanceRequests: "rowAttendanceRequests",
  attendanceInstallations: "rowAttendanceInstallations",
  contactCreateRequests: "rowContactCreateRequests",
  customerCreateRequests: "rowCustomerCreateRequests",
  routeChangeRequests: "rowRouteChangeRequests",
  routesAwaitingPublish: "rowRoutesAwaitingPublish",
  olderAlerts: "rowOlderAlerts",
  photosPendingReview: "rowPhotosPendingReview",
} as const satisfies Record<MtmPanelAttentionKind, string>

const CTA_KEY = {
  customerLocationRequests: "ctaLocation",
  attendanceRequests: "ctaRequest",
  attendanceInstallations: "ctaRequest",
  contactCreateRequests: "ctaRequest",
  customerCreateRequests: "ctaRequest",
  routeChangeRequests: "ctaRequest",
  routesAwaitingPublish: "ctaPublish",
  olderAlerts: "ctaResolve",
  photosPendingReview: "ctaReviewPhotos",
} as const satisfies Record<MtmPanelAttentionKind, string>

/** Where each button leads and what is decided there, said under the cursor. */
const CTA_HINT_KEY = {
  customerLocationRequests: "hint.ctaLocationRequests",
  attendanceRequests: "hint.ctaAttendanceRequests",
  attendanceInstallations: "hint.ctaAttendanceInstallations",
  contactCreateRequests: "hint.ctaContactCreate",
  customerCreateRequests: "hint.ctaCustomerCreate",
  routeChangeRequests: "hint.ctaRouteChange",
  routesAwaitingPublish: "hint.ctaPublish",
  olderAlerts: "hint.ctaAlerts",
  photosPendingReview: "hint.ctaPhotos",
} as const satisfies Record<MtmPanelAttentionKind, string>

const ROW_TONE: Record<MtmPanelAttentionKind, HomeTone> = {
  // Red: somebody is waiting for this one on the spot, not at a desk.
  customerLocationRequests: "red",
  attendanceRequests: "amber",
  attendanceInstallations: "amber",
  contactCreateRequests: "blue",
  customerCreateRequests: "blue",
  routeChangeRequests: "blue",
  routesAwaitingPublish: "amber",
  olderAlerts: "amber",
  photosPendingReview: "zinc",
}

function rowIcon(kind: MtmPanelAttentionKind): ReactNode {
  const className = "h-5 w-5"
  switch (kind) {
    case "customerLocationRequests": return <MapPin className={className} aria-hidden="true" />
    case "attendanceInstallations":
    case "attendanceRequests": return <CalendarDays className={className} aria-hidden="true" />
    case "contactCreateRequests": return <UserPlus className={className} aria-hidden="true" />
    case "customerCreateRequests": return <Building2 className={className} aria-hidden="true" />
    case "routeChangeRequests": return <RouteIcon className={className} aria-hidden="true" />
    case "routesAwaitingPublish": return <CalendarDays className={className} aria-hidden="true" />
    case "olderAlerts": return <AlertTriangle className={className} aria-hidden="true" />
    case "photosPendingReview": return <ImageIcon className={className} aria-hidden="true" />
  }
}

/** A calendar day: a date key is read at UTC so no timezone moves it. */
function dayLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? value : createDateFormatter(locale, { timeZone: "UTC", ...options }).format(date)
}

/** How many rows the card draws: every list with something in it, plus a next working day nobody planned. */
export function attentionRowCount(data: MtmPanelAttention | null): number | null {
  if (!data) return null
  return data.items.length + (data.nextWorkday && data.nextWorkday.withoutRoute > 0 ? 1 : 0)
}

export function HomeAttentionCard({ state }: { state: HomeAttentionState }) {
  const t = useTranslations("mtmDashboardPage.home")
  const alertT = useTranslations("mtmAlertsPage")
  const locale = useLocale()
  const { data } = state
  const short = (date: string) => dayLabel(date, locale, { day: "numeric", month: "short" })
  /** The hour a request was sent, in the organization's own time. */
  const clock = (at: string, timeZone: string): string | null => {
    const date = new Date(at)
    return Number.isNaN(date.getTime()) ? null : createDateFormatter(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)
  }

  function peopleLine(people: readonly string[], total: number): string | null {
    if (people.length === 0) return null
    if (people.length === 1 && total <= 1) return people[0]
    if (people.length >= 2 && total <= 2) return t("peopleTwo", { first: people[0], second: people[1] })
    if (people.length >= 2) return t("peopleMore", { first: people[0], second: people[1], count: total - 2 })
    return people[0]
  }

  function itemSub(item: MtmPanelAttentionItem): string {
    const parts: Array<string | null> = []
    switch (item.kind) {
      case "customerLocationRequests": {
        // Sent today: the row says since what hour, because the agent may still be there.
        const time = item.since && data && item.date === data.today ? clock(item.since, data.timezone) : null
        parts.push(
          peopleLine(item.people, item.peopleCount),
          time ? t("subWaitingSinceTime", { time }) : item.date ? t("subWaitingSince", { date: short(item.date) }) : null,
        )
        break
      }
      case "attendanceInstallations":
      case "attendanceRequests":
      case "contactCreateRequests":
      case "customerCreateRequests":
      case "routeChangeRequests":
        parts.push(peopleLine(item.people, item.peopleCount), item.date ? t("subWaitingSince", { date: short(item.date) }) : null)
        break
      case "routesAwaitingPublish":
        parts.push(peopleLine(item.people, item.peopleCount), item.date ? t("subNearest", { date: short(item.date) }) : null)
        break
      case "olderAlerts":
        parts.push(
          item.date ? short(item.date) : null,
          item.types.length
            ? item.types.map((entry) => t("alertType", {
                count: entry.count,
                label: alertT.has(`typeLabel_${entry.type}` as never) ? alertT(`typeLabel_${entry.type}` as never) : alertT("typeLabel_OTHER"),
              })).join(", ")
            : null,
        )
        break
      case "photosPendingReview":
        parts.push(item.date ? t("subOldest", { date: short(item.date) }) : null)
        break
    }
    return parts.filter(Boolean).join(" · ")
  }

  const rows: Array<{ key: string; tone: HomeTone; icon: ReactNode; title: string; sub: string; href: string; cta: string; hint: string }> = data
    ? data.items.map((item) => ({
        key: item.kind,
        tone: ROW_TONE[item.kind],
        icon: rowIcon(item.kind),
        title: t(ROW_KEY[item.kind], { count: item.count }),
        sub: itemSub(item),
        href: attentionItemHref(item),
        cta: t(CTA_KEY[item.kind]),
        hint: t(CTA_HINT_KEY[item.kind]),
      }))
    : []
  const next = data?.nextWorkday && data.nextWorkday.withoutRoute > 0 ? data.nextWorkday : null
  if (data && next) {
    const tomorrow = next.date === addDateKeyDays(data.today, 1)
    const who = next.people.length > 0 && next.people.length >= next.withoutRoute
      ? t("subWithoutRoute", { people: next.people.join(", ") })
      : t("subWithoutRouteCount", { count: next.withoutRoute, total: next.agents })
    rows.push({
      key: "next-workday",
      tone: "red",
      icon: <RouteIcon className="h-5 w-5" aria-hidden="true" />,
      title: tomorrow ? t("rowNoRouteTomorrow") : t("rowNoRouteDate", { date: short(next.date) }),
      sub: [dayLabel(next.date, locale, { weekday: "long", day: "numeric", month: "long" }), who].join(" · "),
      href: nextWorkdayHref(next),
      cta: t("ctaPlan"),
      hint: t("hint.ctaPlanNextDay"),
    })
  }

  return (
    <HomeCard
      testId="mtm-home-attention"
      titleId="mtm-home-attention-title"
      icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
      tone={rows.length > 0 ? "amber" : "green"}
      title={t("kpiAttention")}
      badge={rows.length > 0 ? String(rows.length) : null}
    >
      {!data ? (
        state.failed ? (
          // A check that could not be read must not look like «nothing is waiting».
          <p role="alert" data-testid="mtm-home-attention-error" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 text-sm">
            <WifiOff className="h-4 w-4 text-red-600" aria-hidden="true" />
            <span className="font-semibold">{t("attentionLoadFailed")}</span>
            <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={state.retry}>{t("retry")}</Button>
          </p>
        ) : (
          <div className="space-y-3 py-4" aria-hidden="true">
            {[0, 1].map((key) => <div key={key} className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />)}
          </div>
        )
      ) : rows.length === 0 ? (
        <p data-testid="mtm-home-attention-clear" className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />{t("attentionEmpty")}
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.key} data-testid={`mtm-home-attention-${row.key}`} className="flex items-center gap-3 border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800">
              {/* The icon keeps its row's colour, with no square under it (2026-10-18). */}
              <span className={cn("flex h-10 w-7 shrink-0 items-center justify-center", HOME_ICON[row.tone])}>{row.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{row.title}</p>
                {row.sub ? <p className="text-xs text-muted-foreground">{row.sub}</p> : null}
              </div>
              {/* Every row's button is outlined: the list stands first by its
                  place, and a filled orange button here was a second fill on
                  the screen (owner-approved colours, 2026-10-18). */}
              <Hint text={row.hint}>
                <Button asChild size="sm" variant="outline" className="min-h-11 shrink-0 md:min-h-9">
                  <Link href={row.href} prefetch={false}>{row.cta}</Link>
                </Button>
              </Hint>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  )
}
