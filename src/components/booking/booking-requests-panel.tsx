"use client"

/**
 * Times a WhatsApp client chose that the salon's rules send to a person.
 * The chair is held meanwhile, so this queue is not a race — but it is the
 * client waiting, and the card says everything needed to decide without
 * opening the conversation: who, what, when, and which rule stopped it.
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Hourglass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BookingAvatar } from "./booking-day-timeline"
import { servicePriceLabel } from "@/lib/booking/service"
import { formatDate, formatTime } from "@/lib/format-date"

export interface BookingRequestRow {
  id: string
  startsAt: string
  endsAt: string
  createdAt: string
  reason: string | null
  service: { title: string; durationMinutes: number; price: string | null; priceCurrency: string | null } | null
  hostName: string | null
  client: { name: string; phone: string | null }
  asked: string
}

export function BookingRequestsPanel({ timezone, onReviewed }: { timezone: string; onReviewed?: () => void }) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [requests, setRequests] = useState<BookingRequestRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/bookings/requests", { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.success) setRequests(body.data.requests)
    } catch { /* the queue is not the screen's main job; silence is better than a banner */ }
  }, [])

  useEffect(() => { void load() }, [load])

  async function review(id: string, approve: boolean) {
    setBusy(id)
    setError("")
    try {
      const response = await fetch("/api/v1/bookings/requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approve }),
      })
      const body = await response.json().catch(() => null)
      // «Taken» is not a failure of the press: somebody booked that chair in
      // the salon meanwhile, and the client has already been told.
      if (!response.ok && body?.data?.outcome !== "taken") throw new Error("failed")
      if (body?.data?.outcome === "taken") setError(t("waRequestTaken"))
      await load()
      onReviewed?.()
    } catch {
      setError(t("waRequestError"))
    } finally {
      setBusy(null)
    }
  }

  if (!requests.length) return null
  const day = (value: string) => formatDate(value, locale, { weekday: "short", day: "numeric", month: "long", timeZone: timezone })
  const time = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })

  return <section aria-label={t("waRequestsTitle")} className="overflow-hidden rounded-xl border border-amber-300 bg-card dark:border-amber-900">
    <div className="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50/70 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
      <Hourglass aria-hidden="true" className="h-4 w-4 text-amber-700 dark:text-amber-300" />
      <h2 className="text-base font-semibold">{t("waRequestsTitle")}</h2>
      <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{requests.length}</span>
    </div>
    {error ? <p role="alert" className="border-b px-5 py-2 text-sm text-destructive">{error}</p> : null}
    <ul className="divide-y divide-border">
      {requests.map((request) => {
        const price = servicePriceLabel(request.service, locale)
        const who = request.client.name || request.client.phone || t("waRequestUnknownClient")
        return <li key={request.id} className="p-5">
          <div className="flex items-start gap-3">
            <BookingAvatar name={who} seed={request.id} className="h-11 w-11 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px] font-bold [overflow-wrap:anywhere]">
                {who}{request.client.phone && request.client.name ? <span className="font-medium text-muted-foreground"> · {request.client.phone}</span> : null}
              </p>
              <p className="mt-0.5 break-words text-sm">
                <span className="font-semibold">{request.service?.title ?? "—"}</span>
                {request.service ? ` · ${t("minutes", { count: request.service.durationMinutes })}` : ""}
                {price ? ` · ${price}` : ""}
                {request.hostName ? ` · ${request.hostName}` : ""}
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums first-letter:uppercase">{day(request.startsAt)}, {time(request.startsAt)}–{time(request.endsAt)}</p>
              {request.reason ? <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                {t("waRequestOutside", { reason: t(`waReason_${request.reason}`) })}
              </p> : null}
              {request.asked ? <p className="mt-2 break-words text-sm text-muted-foreground">{t("waRequestAsked", { text: request.asked })}</p> : null}
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button disabled={busy === request.id} onClick={() => void review(request.id, true)}>{t("waRequestApprove")}</Button>
            <Button variant="outline" disabled={busy === request.id} onClick={() => void review(request.id, false)}>{t("waRequestDecline")}</Button>
            <span className="text-xs text-muted-foreground">{t("waRequestWritesBack")}</span>
          </div>
        </li>
      })}
    </ul>
  </section>
}
