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
import { CalendarCheck, CalendarClock, Clock, Loader2, MapPin, Phone, User, Video, ArrowLeft, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DaySlots } from "@/lib/booking/availability"
import { servicePriceLabel } from "@/lib/booking/service"
import { formatDate, formatTime } from "@/lib/format-date"
import { timezoneOffsetLabel } from "@/lib/timezone"

export interface PublicBookingPage {
  orgName: string
  title: string
  description: string | null
  durationMinutes: number
  locationType: "office" | "phone" | "online"
  locationText: string | null
  /** Decimal from the database, as a string; absent where a view has no price to tell. */
  price?: string | null
  priceCurrency?: string | null
  hostNames: string[]
  /**
   * The masters a customer may choose between, with what each one charges and
   * how long they take. Empty where everybody charges the same — then who is
   * free stays the server's business and nothing is asked.
   */
  hosts?: { id: string; name: string; price: string | null; durationMinutes: number }[]
  /** The master already chosen; null = whoever is free. */
  chosenHostId?: string | null
  /** The lowest price, when the masters differ and none is chosen yet. */
  priceFrom?: string | null
  /** Extras the service offers, and the ones already ticked. */
  addOns?: { id: string; name: string; price: string | null; durationMinutes: number }[]
  chosenAddOnIds?: string[]
  timezone: string
}

export interface BookingRequest {
  startsAt: string
  name: string
  phone: string
  email: string
  note: string
  /** The master the customer chose, where the service offers the choice. */
  hostUserId?: string
  /** The extras they ticked. */
  addOnIds?: string[]
}

export interface BookingConfirmation {
  startsAt: string
  endsAt: string
  hostName: string
  cancelUrl: string
}

export type BookResult =
  | { ok: true; booking: BookingConfirmation }
  | { ok: false; reason: "taken" | "invalid" | "error" | "calendar" | "expired" }

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
  const locale = useLocale()
  const price = servicePriceLabel(page, locale)
  // Masters disagree and none is chosen yet: «from 25» is the only honest
  // number before the customer says who they want.
  const from = !price && page.priceFrom ? servicePriceLabel({ price: page.priceFrom, priceCurrency: page.priceCurrency ?? null }, locale) : null
  return (
    <aside className="space-y-4 border-b pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
      <p className="text-sm font-medium text-muted-foreground">{page.orgName}</p>
      <h1 id="booking-title" className="text-2xl font-bold tracking-tight">{page.title}</h1>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" />{t("minutes", { count: page.durationMinutes })}</li>
        {price || from ? <li className="flex items-center gap-2 font-semibold text-foreground"><Wallet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{price ?? t("previewFrom", { price: from ?? "" })}</li> : null}
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
  page, days, onBook, staff = false, initialStartsAt = null, onStartChange, onHostChange, onAddOnsChange,
}: {
  page: PublicBookingPage
  days: DaySlots[]
  staff?: boolean
  onBook: (request: BookingRequest) => Promise<BookResult>
  /** Asks for the free times of one master; null = whoever is free. */
  onHostChange?: (hostId: string | null) => void
  /** Asks for the free times of the visit with these extras on it. */
  onAddOnsChange?: (addOnIds: string[]) => void
  /** A time already chosen elsewhere — a free window on the day's rail. */
  initialStartsAt?: string | null
  /** Lets the screen around the form draw the time being taken. */
  onStartChange?: (startsAt: string | null) => void
}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const format = useBookingFormat(page.timezone)
  const [date, setDate] = useState<string | null>(days[0]?.date ?? null)
  const [startsAt, setStartsAt] = useState<string | null>(initialStartsAt)
  const chooseStart = (next: string | null) => {
    setStartsAt(next)
    onStartChange?.(next)
  }
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
    const result = await onBook({ startsAt, ...form, hostUserId: page.chosenHostId ?? undefined, addOnIds: page.chosenAddOnIds })
    setBusy(false)
    if (result.ok) {
      setConfirmed(result.booking)
      return
    }
    setError(result.reason === "calendar" ? t("calendarUnavailable") : result.reason === "expired" ? t("confirmationExpired") : result.reason === "taken" ? t("errTaken") : result.reason === "invalid" ? t("errInvalid") : t("errGeneric"))
    if (result.reason === "taken") chooseStart(null)
  }

  if (confirmed) return <BookingConfirmed page={page} booking={confirmed} />

  return (
    <div className={staff ? "space-y-5" : "grid gap-6 md:grid-cols-[260px_1fr]"}>
      {/* The staff panel already names the page, the host and the length in
          its own fields; repeating them here was the same four lines twice. */}
      {staff ? null : <BookingSummary page={page} />}
      <section className="min-w-0 space-y-5" aria-label={t("chooseTime")}>
        {/* Asked only where the answer changes the price or the length. */}
        {!staff && onHostChange && page.hosts && page.hosts.length > 0 && !startsAt ? (
          <div>
            <p className="text-sm font-semibold">{t("pickHost")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[null, ...page.hosts].map((host) => {
                const active = (page.chosenHostId ?? null) === (host?.id ?? null)
                return (
                  <button
                    key={host?.id ?? "any"}
                    type="button"
                    data-crm-color-role="toggle"
                    aria-pressed={active}
                    onClick={() => onHostChange(host?.id ?? null)}
                    className={`min-h-11 rounded-full border px-4 text-sm transition-colors ${active
                      ? "border-primary bg-primary font-bold text-primary-foreground shadow-[0_8px_18px_-12px_hsl(var(--primary))]"
                      : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                  >
                    {host === null ? t("anyHost") : (
                      <span className="inline-flex items-center gap-1.5">
                        {host.name}
                        {host.price ? <span className={`text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>· {servicePriceLabel({ price: host.price, priceCurrency: page.priceCurrency ?? null }, locale)}</span> : null}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {/* Ticking one changes the price and the length of the visit, so the
            times are asked for again — a slot cut for 45 minutes cannot hold a
            visit of 60. */}
        {!staff && onAddOnsChange && page.addOns && page.addOns.length > 0 && !startsAt ? (
          <div>
            <p className="text-sm font-semibold">{t("addOnsPick")}</p>
            <ul className="mt-2 space-y-1.5">
              {page.addOns.map((addOn) => {
                const taken = (page.chosenAddOnIds ?? []).includes(addOn.id)
                return (
                  <li key={addOn.id}>
                    <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${taken ? "border-primary bg-primary/10 font-semibold" : "bg-card hover:border-primary/40"}`}>
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] shrink-0 accent-[hsl(var(--primary))]"
                        checked={taken}
                        onChange={() => onAddOnsChange(taken
                          ? (page.chosenAddOnIds ?? []).filter((id) => id !== addOn.id)
                          : [...(page.chosenAddOnIds ?? []), addOn.id])}
                      />
                      <span className="min-w-0 flex-1 truncate">{addOn.name}</span>
                      {addOn.durationMinutes > 0 ? <span className={`shrink-0 text-xs ${taken ? "text-primary" : "text-muted-foreground"}`}>+{t("minutes", { count: addOn.durationMinutes })}</span> : null}
                      {addOn.price ? <span className="shrink-0 font-semibold tabular-nums">{servicePriceLabel({ price: addOn.price, priceCurrency: page.priceCurrency ?? null }, locale)}</span> : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {days.length === 0 ? (
          <div className="rounded-lg border p-6 text-center">
            <CalendarClock className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 font-medium">{t("noSlotsTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("noSlotsDesc")}</p>
          </div>
        ) : startsAt ? (
          <div className="space-y-4">
            <button type="button" className="flex items-center gap-1 text-sm font-medium text-primary" onClick={() => chooseStart(null)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("changeTime")}
            </button>
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">{t("yourTime")}</p>
              <p className="text-lg font-semibold">{format.longDay(startsAt)}, {format.time(startsAt)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="booking-name">{t(staff ? "clientName" : "name")}</Label>
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
            <Hint text={staff && !canSubmit && !busy ? t("bookDisabledHint") : ""} wrap>
              <Button className="min-h-11 w-full sm:w-auto" onClick={() => void submit()} disabled={!canSubmit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
                {t(staff ? "bookForClient" : "book", { time: format.time(startsAt) })}
              </Button>
            </Hint>
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
                    data-crm-color-role="toggle"
                    onClick={() => setDate(item.date)}
                    aria-pressed={item.date === date}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${item.date === date
                      ? "border-primary bg-primary font-bold text-primary-foreground shadow-[0_8px_18px_-12px_hsl(var(--primary))]"
                      : "bg-card hover:border-primary/40 hover:bg-primary/5"}`}
                  >
                    <span className="block capitalize">{format.day(item.date)}</span>
                    <span className={`block text-xs font-normal ${item.date === date ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{t("freeCount", { count: item.slots.length })}</span>
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
                      onClick={() => chooseStart(slot.startsAt)}
                      className="min-h-11 rounded-xl border bg-card px-2 py-2.5 text-sm font-semibold tabular-nums transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
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
