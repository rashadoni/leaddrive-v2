"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BookingScheduler, type BookResult, type BookingRequest, type PublicBookingPage } from "./booking-scheduler"
import { BOOKING_ERROR_KEYS } from "./booking-meeting-actions"
import { bookingRequestIdentity, completeBookingRequest } from "@/lib/booking/client-identity"
import { dateInputValueInTimezone } from "@/lib/timezone"
import type { DaySlots } from "@/lib/booking/availability"

export function BookingCreatePanel({ pages, hosts, timezone, onSaved }: { pages: { id: string; title: string; hostIds: string[] }[]; hosts: { id: string; name: string }[]; timezone: string; onSaved: (id: string) => void }) {
  const t = useTranslations("booking"), locale = useLocale()
  const [pageId, setPageId] = useState(pages[0]?.id ?? "")
  const [hostId, setHostId] = useState("")
  const [day, setDay] = useState(() => dateInputValueInTimezone(new Date(), timezone))
  const [error, setError] = useState("")
  const available = useQuery({
    queryKey: ["booking-create-slots", pageId, day, hostId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/v1/bookings/availability?${new URLSearchParams({ pageId, day, ...(hostId ? { hostId } : {}) })}`, { signal, cache: "no-store" })
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error(body.code ?? "LOAD_FAILED")
      return body.data as { page: PublicBookingPage; days: DaySlots[] }
    }, enabled: Boolean(pageId), retry: false,
  })
  async function book(request: BookingRequest): Promise<BookResult> {
    setError("")
    try {
      const identity = await bookingRequestIdentity(`staff-create:${pageId}`, { ...request, hostUserId: hostId || null })
      const response = await fetch("/api/v1/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, ...identity, pageId, locale, ...(hostId ? { hostUserId: hostId } : {}) }) })
      const body = await response.json()
      if (!response.ok || !body.success) {
        setError(t(BOOKING_ERROR_KEYS[body.code] ?? "errSave"))
        if (body.code === "SLOT_TAKEN") { void available.refetch(); return { ok: false, reason: "taken" } }
        return { ok: false, reason: response.status === 400 ? "invalid" : "error" }
      }
      completeBookingRequest(`staff-create:${pageId}`)
      onSaved(body.data.id)
      return { ok: true, booking: body.data }
    } catch { setError(t("commandUnconfirmed")); return { ok: false, reason: "error" } }
  }
  return <div className="mt-5 space-y-5">
    <p className="text-sm text-muted-foreground">{t("createMeetingHint")}</p>
    {!pages.length ? <p>{t("noAvailablePages")}</p> : <>
      <div className="space-y-1"><Label htmlFor="create-meeting-page">{t("colPage")}</Label><select id="create-meeting-page" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={pageId} onChange={(event) => { setPageId(event.target.value); setHostId("") }}>{pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="create-meeting-host">{t("colHosts")}</Label><select id="create-meeting-host" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={hostId} onChange={(event) => setHostId(event.target.value)}><option value="">{t("automaticHost")}</option>{hosts.filter((host) => pages.find((page) => page.id === pageId)?.hostIds.includes(host.id)).map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="create-meeting-day">{t("chooseDay")}</Label><Input type="date" id="create-meeting-day" value={day} onChange={(event) => { if (event.target.value) setDay(event.target.value) }} /></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {available.isFetching ? <p role="status">{t("checkingSlots")}</p> : available.isError ? <p role="alert">{t(BOOKING_ERROR_KEYS[available.error.message] ?? "errLoad")}</p> : available.data ? <BookingScheduler key={`${pageId}:${day}:${hostId}`} page={available.data.page} days={available.data.days} onBook={book} staff /> : null}
    </>}
  </div>
}
