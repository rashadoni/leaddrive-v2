"use client"

/**
 * What a customer sees on a booking link: who they are meeting and for how
 * long, the days that still have free time, the times on the chosen day, and
 * a short form. Times are shown on the organization's clock and say so —
 * customers and staff are almost always in the same city, and one clock on
 * both sides avoids "was it 15:00 mine or yours".
 *
 * Only days with free time are listed: a greyed-out day reads as broken.
 */
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck, CalendarClock, Clock, Loader2, MapPin, Phone, User, Video, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DaySlots } from "@/lib/booking/availability"
import { formatDate, formatTime } from "@/lib/format-date"
import { timezoneOffsetLabel } from "@/lib/timezone"

export interface PublicBookingPage {
  orgName: string
  title: string
  description: string | null
  durationMinutes: number
  locationType: "office" | "phone" | "online"
  locationText: string | null
  hostNames: string[]
  timezone: string
}

export interface BookingRequest {
  startsAt: string
  name: string
  phone: string
  email: string
  note: string
}

export interface BookingConfirmation {
  startsAt: string
  endsAt: string
  hostName: string
  cancelUrl: string
}

export type BookResult =
  | { ok: true; booking: BookingConfirmation }
  | { ok: false; reason: "taken" | "invalid" | "error" }

const INTL: Record<string, string> = { az: "az-AZ", ru: "ru-RU", en: "en-GB" }

/**
 * Dates go through src/lib/format-date.ts: browsers whose ICU has no
 * Azerbaijani data print "M10 26, Mon" and "Azerbaijan Standard Time" — seen
 * on prod on the first live run of this page.
 */
export function useBookingFormat(timezone: string) {
  const locale = INTL[useLocale()] ?? "az-AZ"
  const t = useTranslations("booking")
  return useMemo(() => ({
    time: (iso: string) => formatTime(iso, locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }),
    day: (date: string) => formatDate(`${date}T12:00:00Z`, locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }),
    longDay: (iso: string) => formatDate(iso, locale, { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }),
    zone: () => timezone === "Asia/Baku"
      ? t("zoneBaku")
      : `${timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone} (${timezoneOffsetLabel(timezone)})`,
  }), [locale, timezone, t])
}

function LocationIcon({ type }: { type: PublicBookingPage["locationType"] }) {
  if (type === "phone") return <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
  if (type === "online") return <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
  return <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
}

export function BookingSummary({ page }: { page: PublicBookingPage }) {
  const t = useTranslations("booking")
  return (
    <aside className="space-y-4 border-b pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
      <p className="text-sm font-medium text-muted-foreground">{page.orgName}</p>
      <h1 id="booking-title" className="text-2xl font-bold tracking-tight">{page.title}</h1>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" />{t("minutes", { count: page.durationMinutes })}</li>
        <li className="flex items-center gap-2"><LocationIcon type={page.locationType} />{page.locationText || t(`location_${page.locationType}`)}</li>
        {page.hostNames.length > 0 ? (
          <li className="flex items-center gap-2"><User className="h-4 w-4 shrink-0" aria-hidden="true" />{page.hostNames.join(", ")}</li>
        ) : null}
      </ul>
      {page.description ? <p className="whitespace-pre-line text-sm leading-6">{page.description}</p> : null}
    </aside>
  )
}

export function BookingScheduler({
  page, days, onBook,
}: {
  page: PublicBookingPage
  days: DaySlots[]
  onBook: (request: BookingRequest) => Promise<BookResult>
}) {
  const t = useTranslations("booking")
  const format = useBookingFormat(page.timezone)
  const [date, setDate] = useState<string | null>(days[0]?.date ?? null)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", phone: "", email: "", note: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null)

  const day = days.find((item) => item.date === date) ?? null
  const canSubmit = Boolean(startsAt) && form.name.trim().length > 1 && form.phone.trim().length >= 7 && !busy

  async function submit() {
    if (!startsAt || !canSubmit) return
    setBusy(true)
    setError("")
    const result = await onBook({ startsAt, ...form })
    setBusy(false)
    if (result.ok) {
      setConfirmed(result.booking)
      return
    }
    setError(result.reason === "taken" ? t("errTaken") : result.reason === "invalid" ? t("errInvalid") : t("errGeneric"))
    if (result.reason === "taken") setStartsAt(null)
  }

  if (confirmed) return <BookingConfirmed page={page} booking={confirmed} />

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <BookingSummary page={page} />
      <section className="min-w-0 space-y-5" aria-label={t("chooseTime")}>
        {days.length === 0 ? (
          <div className="rounded-lg border p-6 text-center">
            <CalendarClock className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 font-medium">{t("noSlotsTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("noSlotsDesc")}</p>
          </div>
        ) : startsAt ? (
          <div className="space-y-4">
            <button type="button" className="flex items-center gap-1 text-sm font-medium text-primary" onClick={() => setStartsAt(null)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("changeTime")}
            </button>
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">{t("yourTime")}</p>
              <p className="text-lg font-semibold">{format.longDay(startsAt)}, {format.time(startsAt)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="booking-name">{t("name")}</Label>
                <Input id="booking-name" className="mt-1" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="booking-phone">{t("phone")}</Label>
                <Input id="booking-phone" className="mt-1" type="tel" autoComplete="tel" placeholder="+994 50 000 00 00" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="booking-email">{t("email")}</Label>
                <Input id="booking-email" className="mt-1" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">{t("emailHint")}</p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="booking-note">{t("note")}</Label>
                <Textarea id="booking-note" className="mt-1" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <Button className="min-h-11 w-full sm:w-auto" onClick={() => void submit()} disabled={!canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
              {t("book", { time: format.time(startsAt) })}
            </Button>
          </div>
        ) : (
          <>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div>
              <h2 className="mb-2 text-sm font-semibold">{t("chooseDay")}</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {days.map((item) => (
                  <button
                    key={item.date}
                    type="button"
                    onClick={() => setDate(item.date)}
                    aria-pressed={item.date === date}
                    className={`rounded-lg border px-2 py-2 text-left text-sm transition-colors ${item.date === date ? "border-primary bg-primary/5 font-semibold text-primary" : "hover:border-primary/50"}`}
                  >
                    <span className="block capitalize">{format.day(item.date)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{t("freeCount", { count: item.slots.length })}</span>
                  </button>
                ))}
              </div>
            </div>
            {day ? (
              <div>
                <h2 className="mb-2 text-sm font-semibold">{t("chooseTime")}</h2>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {day.slots.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => setStartsAt(slot.startsAt)}
                      className="rounded-lg border px-2 py-2.5 text-sm font-medium tabular-nums hover:border-primary hover:text-primary"
                    >
                      {format.time(slot.startsAt)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t("timezoneNote", { zone: format.zone() })}</p>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

export function BookingConfirmed({ page, booking }: { page: PublicBookingPage; booking: BookingConfirmation }) {
  const t = useTranslations("booking")
  const format = useBookingFormat(page.timezone)
  return (
    <div className="mx-auto max-w-md py-4 text-center">
      <CalendarCheck className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
      <h1 className="mt-3 text-2xl font-bold">{t("confirmedTitle")}</h1>
      <p className="mt-2 text-lg font-semibold">{format.longDay(booking.startsAt)}, {format.time(booking.startsAt)}–{format.time(booking.endsAt)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{page.title} · {booking.hostName} · {page.orgName}</p>
      <p className="mt-1 text-sm text-muted-foreground">{page.locationText || t(`location_${page.locationType}`)}</p>
      <p className="mt-4 text-sm">{t("confirmedNote")}</p>
      <a className="mt-4 inline-block text-sm font-medium text-muted-foreground underline" href={booking.cancelUrl}>{t("cancelLink")}</a>
    </div>
  )
}
