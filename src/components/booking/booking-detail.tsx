"use client"

/**
 * One meeting, the same card whether it opens beside the day's rail or in the
 * panel the list opens. It answers, in this order: when, with whom, what they
 * wrote, what has already gone out to them, and what can still be done.
 *
 * "What has already gone out" used to be six lines of grey text at the very
 * bottom — the one thing someone checks before phoning a client to ask why
 * they never got the confirmation.
 */
import { CalendarDays, CheckCircle2, Clock3, MapPin, Phone, Send, TriangleAlert, UserRound } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import { formatDate, formatTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { BookingFollowUp } from "./booking-follow-up"
import { BookingHistory } from "./booking-history"
import { BookingMeetingActions, type BookingActionContext } from "./booking-meeting-actions"
import { BookingStatus, bookingStatusTone } from "./booking-status"
import type { WorkspaceBooking } from "./booking-workspace"

/** White text sits on each of these at 4.5:1 or better. */
const AVATAR_TONES = ["bg-violet-600", "bg-sky-700", "bg-emerald-700", "bg-rose-600", "bg-indigo-600", "bg-teal-700"]

export function avatarTone(seed: string): string {
  let sum = 0
  for (const character of seed) sum = (sum + (character.codePointAt(0) ?? 0)) % 9973
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

export function nameInitials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0] ?? "").join("")
  return letters ? letters.toLocaleUpperCase() : "?"
}

export function integrationLabel(type: string): string {
  return ({ "booking.push": "deliveryPush", "booking.host-email": "deliveryHostEmail", "booking.calendar": "deliveryCalendar", "booking.email": "deliveryEmail", "booking.project": "deliveryCrm", "booking.notify": "deliveryNotification" } as Record<string, string>)[type] ?? "deliveryOther"
}

/** Three outcomes, in the words someone would use about a message they sent. */
export function deliveryState(item: { status: string; requiresAttention?: boolean }): "sent" | "waiting" | "check" {
  if (item.requiresAttention || item.status === "reconciliation_required" || item.status === "definitely_failed") return "check"
  return item.status === "succeeded" ? "sent" : "waiting"
}

export function BookingDetail({ booking, context, identity, onSaved, onClose }: {
  booking: WorkspaceBooking
  context: BookingActionContext
  /** Scopes the cached history to the organization and to what this person may read. */
  identity: string
  onSaved: () => void
  /** Beside the day’s rail the card is the column, so it carries its own way out. */
  onClose?: () => void
}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const timezone = booking.bookingPage.timezone || context.timezone
  const day = (value: string) => formatDate(value, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })
  const shortDay = (value: string) => formatDate(value, locale, { day: "numeric", month: "short", timeZone: timezone })
  const time = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })
  const statusLabel = t(({ confirmed: "meetingConfirmed", cancelled: "meetingCancelled", completed: "meetingCompleted", no_show: "meetingNoShow" } as Record<string, string>)[booking.status] ?? "meetingUnknownStatus")
  const locationType = ["office", "phone", "online"].includes(booking.bookingPage.locationType) ? booking.bookingPage.locationType : "office"

  return <div className="space-y-4">
    <CrmSection tone={bookingStatusTone(booking.status)} aria-label={t("meetingSummary")}>
      <div className="flex flex-wrap items-start gap-4">
        <p className="flex min-w-16 shrink-0 flex-col items-center rounded-xl bg-primary px-3 py-2 text-center font-semibold text-primary-foreground">
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
          <span className="mt-1 whitespace-nowrap text-sm">{shortDay(booking.startsAt)}</span>
        </p>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-semibold tabular-nums">{time(booking.startsAt)}–{time(booking.endsAt)}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-sm text-muted-foreground">
            <BookingStatus status={booking.status}>{statusLabel}</BookingStatus>
            {/* The page states the organization’s clock once; only a page on its own clock repeats it. */}
            {day(booking.startsAt)}{timezone === context.timezone ? "" : ` · ${timezone}`}
          </p>
        </div>
        {onClose ? <Button variant="ghost" size="sm" className="-mr-2 -mt-1 shrink-0" onClick={onClose}>{t("close")}</Button> : null}
      </div>
    </CrmSection>
    <CrmSection title={t("contactDetails")} icon={<UserRound aria-hidden="true" className="h-4 w-4" />}>
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white", avatarTone(booking.id))}>{nameInitials(booking.name)}</span>
        <span className="min-w-0">
          <span className="block break-words font-semibold">{booking.name}</span>
          <span className="block break-words text-sm text-muted-foreground">{booking.bookingPage.title}</span>
        </span>
      </div>
      <dl className="space-y-2.5 text-sm">
        <div><dt className="sr-only">{t("colHosts")}</dt><dd className="flex min-w-0 items-start gap-2.5 break-words font-medium"><UserRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{booking.hostName ?? t("hostUnknown")}</dd></div>
        <div><dt className="sr-only">{t("phone")}</dt><dd className="flex min-w-0 items-start gap-2.5 font-medium [overflow-wrap:anywhere]"><Phone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{booking.phone}</dd></div>
        {booking.email ? <div><dt className="sr-only">{t("email")}</dt><dd className="flex min-w-0 items-start gap-2.5 font-medium [overflow-wrap:anywhere]"><Send aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{booking.email}</dd></div> : null}
        <div><dt className="sr-only">{t("fieldLocation")}</dt><dd className="flex min-w-0 items-start gap-2.5 whitespace-pre-wrap break-words font-medium"><MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{booking.bookingPage.locationText || t(`location_${locationType}`)}</dd></div>
        <div><dt className="sr-only">{t("workspaceHistory")}</dt><dd className="flex min-w-0 items-start gap-2.5 break-words text-muted-foreground"><Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t("createdOn", { date: day(booking.createdAt), time: time(booking.createdAt) })}</dd></div>
      </dl>
    </CrmSection>
    {booking.note ? <CrmSection title={t("customerNote")}><p className="whitespace-pre-wrap break-words text-sm">{booking.note}</p></CrmSection> : null}
    <CrmSection title={t("deliverySent")} icon={<Send aria-hidden="true" className="h-4 w-4" />}>
      {booking.integrations?.length ? <ul className="space-y-2.5">
        {booking.integrations.map((item, index) => {
          const state = deliveryState(item)
          return <li key={`${item.type}:${item.status}:${index}`} className="flex items-start gap-2.5 text-sm">
            {state === "sent" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" /> : state === "check" ? <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" /> : <Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 break-words">
              <span className="font-medium">{t(integrationLabel(item.type))}</span>
              <span className={cn("ml-2 text-xs", state === "sent" ? "text-emerald-700 dark:text-emerald-300" : state === "check" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{t(state === "sent" ? "deliveryApplied" : state === "check" ? "deliveryNeedsCheck" : "deliveryPending")}{item.count > 1 ? ` · ${item.count}` : ""}</span>
            </span>
          </li>
        })}
      </ul> : <p className="text-sm text-muted-foreground">{t("calendarLinkState", { state: t(booking.calendarLinked ? "calendarLinked" : "calendarNotLinked") })}</p>}
    </CrmSection>
    <BookingMeetingActions key={`${booking.id}:${booking.version}`} booking={booking} context={context} onSaved={onSaved} />
    {booking.outcomeNote ? <CrmSection title={t("outcomeNote")}><p className="whitespace-pre-wrap break-words text-sm">{booking.outcomeNote}</p></CrmSection> : null}
    {booking.cancellationReason ? <CrmSection title={t("changeReason")} tone="destructive"><p className="whitespace-pre-wrap break-words text-sm">{booking.cancellationReason}</p></CrmSection> : null}
    <BookingFollowUp key={booking.id} booking={booking} />
    <BookingHistory booking={booking} timezone={timezone} cacheScope={`${identity}:${Boolean(booking.phoneRestricted)}`} />
    {booking.leadId || booking.taskId ? <CrmSection><div className="flex flex-wrap gap-2">
      {booking.leadId ? <Button variant="outline" size="sm" asChild><a href={`/leads/${encodeURIComponent(booking.leadId)}`}>{t("openLead")}</a></Button> : null}
      {booking.taskId ? <Button variant="ghost" size="sm" asChild><a href={`/tasks/${encodeURIComponent(booking.taskId)}`}>{t("openTask")}</a></Button> : null}
    </div></CrmSection> : null}
  </div>
}
