"use client"

/**
 * One meeting, the same card whether it opens beside the day's rail or in the
 * panel that confirms a booking. It answers, in this order: when, with whom,
 * where, what has already gone out to the client, what else is on that day,
 * and what can still be done.
 *
 * "What has already gone out" used to be six lines of grey text at the very
 * bottom — the one thing someone checks before phoning a client to ask why
 * they never got the confirmation.
 */
import { CalendarDays, CheckCircle2, Clock3, MapPin, Phone, Send, Tag, TriangleAlert, UserRound, Wallet } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import { formatDate, formatTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { servicePriceLabel } from "@/lib/booking/service"
import { BookingAvatar, avatarTone, nameInitials } from "./booking-day-timeline"
import { BookingFollowUp } from "./booking-follow-up"
import { BookingHistory } from "./booking-history"
import { BookingMeetingActions, type BookingActionContext } from "./booking-meeting-actions"
import { BookingStatus } from "./booking-status"
import type { WorkspaceBooking } from "./booking-workspace"

export { avatarTone, nameInitials }

export function integrationLabel(type: string): string {
  return ({ "booking.push": "deliveryPush", "booking.host-email": "deliveryHostEmail", "booking.calendar": "deliveryCalendar", "booking.email": "deliveryEmail", "booking.project": "deliveryCrm", "booking.notify": "deliveryNotification" } as Record<string, string>)[type] ?? "deliveryOther"
}

/** Three outcomes, in the words someone would use about a message they sent. */
export function deliveryState(item: { status: string; requiresAttention?: boolean }): "sent" | "waiting" | "check" {
  if (item.requiresAttention || item.status === "reconciliation_required" || item.status === "definitely_failed") return "check"
  return item.status === "succeeded" ? "sent" : "waiting"
}

/** One line of the host's day, beside the meeting that is open. */
export interface DayScheduleRow {
  id: string | null
  time: string
  name: string
  subtitle: string
  current?: boolean
}

function CapsLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2.5 mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>
}

export function BookingDetail({ booking, context, identity, schedule, onSaved, onClose, onOpenMeeting }: {
  booking: WorkspaceBooking
  context: BookingActionContext
  /** Scopes the cached history to the organization and to what this person may read. */
  identity: string
  /** The host's other meetings that day; empty hides the section. */
  schedule?: DayScheduleRow[]
  onSaved: () => void
  /** Beside the day’s rail the card is the column, so it carries its own way out. */
  onClose?: () => void
  onOpenMeeting?: (id: string) => void
}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const timezone = booking.bookingPage.timezone || context.timezone
  const day = (value: string) => formatDate(value, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })
  const time = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })
  const statusLabel = t(({ confirmed: "meetingConfirmed", cancelled: "meetingCancelled", completed: "meetingCompleted", no_show: "meetingNoShow" } as Record<string, string>)[booking.status] ?? "meetingUnknownStatus")
  const locationType = ["office", "phone", "online"].includes(booking.bookingPage.locationType) ? booking.bookingPage.locationType : "office"
  const price = servicePriceLabel(booking.bookingPage, locale)
  const rows: [React.ReactNode, string, string][] = [
    [<UserRound key="h" aria-hidden="true" className="h-4 w-4" />, t("colHosts"), booking.hostName ?? t("hostUnknown")],
    [<MapPin key="l" aria-hidden="true" className="h-4 w-4" />, t("fieldLocation"), booking.bookingPage.locationText || t(`location_${locationType}`)],
    [<CalendarDays key="p" aria-hidden="true" className="h-4 w-4" />, t("colPage"), booking.bookingPage.title],
    // The price the client was told when they agreed, not today's: the card
    // reads it from the meeting's own snapshot.
    ...(price ? [[<Wallet key="m" aria-hidden="true" className="h-4 w-4" />, t("fieldPrice"), price] as [React.ReactNode, string, string]] : []),
    [<Tag key="c" aria-hidden="true" className="h-4 w-4" />, t("fieldCreated"), `${day(booking.createdAt)}, ${time(booking.createdAt)}`],
  ]

  return <div className="space-y-0" role="region" aria-label={t("workspaceDetails")}>
    {onClose ? <div className="mb-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold">{t("workspaceDetails")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{statusLabel}</p>
      </div>
      <Button variant="ghost" size="sm" className="-mr-2 -mt-1 shrink-0" onClick={onClose}>{t("close")}</Button>
    </div> : null}

    {/* When, with whom, where — the block someone reads out on the phone. */}
    <div className="rounded-2xl bg-muted/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-4">
        <p className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-primary font-bold leading-none text-primary-foreground">
          <span className="text-[10px] uppercase tracking-[0.07em] opacity-90">{formatDate(booking.startsAt, locale, { month: "short", timeZone: timezone })}</span>
          <span className="mt-1 text-2xl">{formatDate(booking.startsAt, locale, { day: "numeric", timeZone: timezone })}</span>
        </p>
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-base font-bold first-letter:uppercase">{formatDate(booking.startsAt, locale, { weekday: "long", day: "numeric", month: "long", timeZone: timezone })}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{time(booking.startsAt)}–{time(booking.endsAt)}</span>
            <BookingStatus status={booking.status}>{statusLabel}</BookingStatus>
            {timezone === context.timezone ? null : timezone}
          </p>
        </div>
      </div>
      <dl className="mt-4 space-y-2.5">
        {rows.map(([icon, label, value]) => <div key={label} className="flex min-w-0 items-start gap-2.5 text-sm">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
          <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 break-words font-semibold">{value}</dd>
        </div>)}
      </dl>
    </div>

    <div className="mt-4 flex items-center gap-3">
      <BookingAvatar name={booking.name} seed={booking.id} className="h-11 w-11 text-base" />
      <div className="min-w-0">
        <p className="break-words text-[15px] font-bold">{booking.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <span className="inline-flex items-center gap-1.5"><Phone aria-hidden="true" className="h-3.5 w-3.5" />{booking.phone}</span>
          {booking.email ? <span className="inline-flex items-center gap-1.5"><Send aria-hidden="true" className="h-3.5 w-3.5" />{booking.email}</span> : null}
        </p>
      </div>
    </div>

    {booking.note ? <><CapsLabel>{t("customerNote")}</CapsLabel><p className="whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-3.5 text-sm">{booking.note}</p></> : null}

    <CapsLabel>{t("deliverySent")}</CapsLabel>
    {booking.integrations?.length ? <ul className="space-y-1">
      {booking.integrations.map((item, index) => {
        const state = deliveryState(item)
        return <li key={`${item.type}:${item.status}:${index}`} className="flex items-center gap-3 py-1">
          <span aria-hidden="true" className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
            state === "sent" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              : state === "check" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300")}>
            {state === "sent" ? <CheckCircle2 className="h-4 w-4" /> : state === "check" ? <TriangleAlert className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold">{t(integrationLabel(item.type))}</span>
            {item.count > 1 ? <span className="block text-xs text-muted-foreground">{t("deliveryCount", { count: item.count })}</span> : null}
          </span>
          <span className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold",
            state === "sent" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              : state === "check" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300")}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {t(state === "sent" ? "deliveryApplied" : state === "check" ? "deliveryNeedsCheck" : "deliveryPending")}
          </span>
        </li>
      })}
    </ul> : <p className="text-sm text-muted-foreground">{t("calendarLinkState", { state: t(booking.calendarLinked ? "calendarLinked" : "calendarNotLinked") })}</p>}

    {schedule?.length ? <>
      <CapsLabel>{t("hostDay", { name: booking.hostName ?? t("hostUnknown") })}</CapsLabel>
      <ul className="-mx-1">
        {schedule.map((row, index) => {
          const body = <>
            <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{row.time}</span>
            {row.id ? <BookingAvatar name={row.name} seed={row.id} /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{row.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span>
            </span>
            {row.current ? <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{t("thisMeeting")}</span> : null}
          </>
          const shell = cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left", row.current ? "border-primary bg-primary/5" : "border-transparent")
          return row.id && !row.current && onOpenMeeting
            ? <li key={`${row.time}:${index}`}><button type="button" onClick={() => onOpenMeeting(row.id!)} className={cn(shell, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{body}</button></li>
            : <li key={`${row.time}:${index}`} className={shell}>{body}</li>
        })}
      </ul>
    </> : null}

    <div className="mt-5">
      <BookingMeetingActions key={`${booking.id}:${booking.version}`} booking={booking} context={context} onSaved={onSaved} />
    </div>
    {booking.outcomeNote ? <CrmSection className="mt-4" title={t("outcomeNote")}><p className="whitespace-pre-wrap break-words text-sm">{booking.outcomeNote}</p></CrmSection> : null}
    {booking.cancellationReason ? <CrmSection className="mt-4" title={t("changeReason")} tone="destructive"><p className="whitespace-pre-wrap break-words text-sm">{booking.cancellationReason}</p></CrmSection> : null}
    <div className="mt-4 space-y-4">
      <BookingFollowUp key={booking.id} booking={booking} timezone={timezone} />
      <BookingHistory booking={booking} timezone={timezone} cacheScope={`${identity}:${Boolean(booking.phoneRestricted)}`} />
      {booking.leadId || booking.taskId ? <CrmSection><div className="flex flex-wrap gap-2">
        {booking.leadId ? <Button variant="outline" size="sm" asChild><a href={`/leads/${encodeURIComponent(booking.leadId)}`}>{t("openLead")}</a></Button> : null}
        {booking.taskId ? <Button variant="ghost" size="sm" asChild><a href={`/tasks/${encodeURIComponent(booking.taskId)}`}>{t("openTask")}</a></Button> : null}
      </div></CrmSection> : null}
    </div>
  </div>
}
