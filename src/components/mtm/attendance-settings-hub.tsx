"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, CalendarDays, Clock, CaseSensitive, FileText, MapPin, Palmtree, QrCode, Shuffle, UserCog } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { ATTENDANCE_ADMIN_SETTINGS, ATTENDANCE_SETTINGS_GROUPS, attendanceWorkWeek, type AttendanceSettingsCard } from "@/lib/mtm/attendance-settings-cards"
import type { MtmAttendanceRule } from "@/lib/mtm/attendance-rules"
import { MtmAttendanceFeatureSwitch } from "@/components/mtm/attendance-feature-switch"

const ICONS: Record<AttendanceSettingsCard, ReactNode> = {
  hours: <Clock className="h-5 w-5" />, holidays: <CalendarDays className="h-5 w-5" />, shifts: <Shuffle className="h-5 w-5" />, "day-kinds": <CaseSensitive className="h-5 w-5" />,
  leave: <Palmtree className="h-5 w-5" />, requests: <FileText className="h-5 w-5" />, qr: <QrCode className="h-5 w-5" />,
  location: <MapPin className="h-5 w-5" />, access: <UserCog className="h-5 w-5" />,
}
const HOLIDAY_KINDS = new Set(["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"])
type Live = { rule?: MtmAttendanceRule; holidays?: number }

/** Personnel → Settings: one page of cards, each with what it is (or its
 * current value) and one button that opens it. Values are best effort: a card
 * whose source fails keeps its plain description. */
export function MtmAttendanceSettingsHub({ isAdmin }: { isAdmin: boolean }) {
  const p = useTranslations("personnel")
  const locale = useLocale() as "az" | "ru" | "en"
  const [live, setLive] = useState<Live>({})
  useEffect(() => {
    const controller = new AbortController()
    const read = async (url: string) => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      return response.ok && body?.success === true ? body.data : null
    }
    void read("/api/v1/mtm/attendance/rules").then(async rules => {
      if (controller.signal.aborted) return
      const today: string | undefined = rules?.today
      if (rules?.current) setLive(previous => ({ ...previous, rule: rules.current }))
      if (!today) return
      const calendar = await read(`/api/v1/mtm/attendance/calendar?${new URLSearchParams({ from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` })}`).catch(() => null)
      if (controller.signal.aborted) return
      setLive(previous => ({ ...previous,
        holidays: Array.isArray(calendar?.days) ? calendar.days.filter((day: { kind: string }) => HOLIDAY_KINDS.has(day.kind)).length : undefined }))
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  // 12 Oct 2026 is a Monday; `day` is JavaScript's weekday number.
  const dayName = (day: number) => formatDate(`2026-10-${String(11 + (day === 0 ? 7 : day)).padStart(2, "0")}T12:00:00.000Z`, locale, { weekday: "short", timeZone: "UTC" })
  const summary = (card: AttendanceSettingsCard): string => {
    if (card === "hours" && live.rule) return p("settingsHoursValue", { days: attendanceWorkWeek(live.rule.weekendDays, dayName), from: live.rule.startTime, to: live.rule.endTime, grace: live.rule.lateGraceMinutes })
    if (card === "holidays" && live.holidays !== undefined) return p("settingsHolidaysValue", { count: live.holidays })
    return p(`settingsCards.${card}.hint`)
  }

  return <div className="space-y-6" data-testid="attendance-settings-hub">
    <h1 className="text-2xl font-bold tracking-tight">{p("settingsTitle")}</h1>
    <MtmAttendanceFeatureSwitch enabled canChange={isAdmin} />
    {ATTENDANCE_SETTINGS_GROUPS.map(group => {
      const cards = group.cards.filter(card => isAdmin || !ATTENDANCE_ADMIN_SETTINGS.includes(card))
      if (!cards.length) return null
      return <section key={group.key} aria-labelledby={`settings-group-${group.key}`} className="space-y-3">
        <h2 id={`settings-group-${group.key}`} className="text-sm font-semibold text-muted-foreground">{p(`settingsGroups.${group.key}`)}</h2>
        <div className="grid gap-3 md:grid-cols-2">{cards.map((card, index) => <Link key={card} href={`/mtm/attendance/settings?tab=${card}`} prefetch={false} data-testid={`attendance-settings-card-${card}`}
          // A card left alone in its row takes the whole row: no half-empty rows.
          className={`${cards.length % 2 && index === cards.length - 1 ? "md:col-span-2 " : ""}group flex min-h-20 items-center gap-4 rounded-2xl border bg-card p-4 outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">{ICONS[card]}</span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">{p(`settingsCards.${card}.title`)}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground first-letter:uppercase">{summary(card)}</span></span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">{p("open")}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
        </Link>)}</div>
      </section>
    })}
  </div>
}
