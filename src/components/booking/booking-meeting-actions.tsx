"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { bookingRequestIdentity } from "@/lib/booking/client-identity"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { formatTime } from "@/lib/format-date"
import type { DaySlots } from "@/lib/booking/availability"
import type { WorkspaceBooking } from "./booking-workspace"

export interface BookingActionContext { timezone: string; hosts: { id: string; name: string; isActive: boolean }[]; writableHostIds: string[] | null }
export const BOOKING_ERROR_KEYS: Record<string, string> = { SLOT_TAKEN: "errTaken", VERSION_CONFLICT: "meetingChanged", AVAILABILITY_CHANGED: "meetingChanged", CALENDAR_UNAVAILABLE: "calendarUnavailable", FORBIDDEN: "workspaceForbidden", NOT_FOUND: "meetingUnavailable", CORRECTION_REQUIRES_REASON: "correctionReasonRequired", INVALID_STATE: "invalidMeetingState", INVALID_HOST: "invalidHost", IDEMPOTENCY_CONFLICT: "meetingChanged", CONFIRMATION_EXPIRED: "confirmationExpired" }

export function BookingMeetingActions({ booking, context, onSaved }: { booking: WorkspaceBooking; context: BookingActionContext; onSaved: () => void }) {
  const t = useTranslations("booking"), locale = useLocale()
  const [mode, setMode] = useState<"cancel" | "reschedule" | "outcome" | null>(null)
  const [day, setDay] = useState(dateInputValueInTimezone(booking.startsAt, context.timezone))
  const [hostId, setHostId] = useState(booking.hostUserId)
  const [startsAt, setStartsAt] = useState("")
  const [outcome, setOutcome] = useState("completed")
  const [note, setNote] = useState(booking.outcomeNote ?? "")
  const [reason, setReason] = useState("")
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const availability = useQuery({
    queryKey: ["booking-move-slots", booking.id, booking.version, hostId, day],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ pageId: booking.bookingPageId, bookingId: booking.id, hostId, day })
      const response = await fetch(`/api/v1/bookings/availability?${params}`, { signal, cache: "no-store" })
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error(body.code ?? "LOAD_FAILED")
      return body.data as { days: DaySlots[]; hosts: { id: string; name: string }[] }
    }, enabled: mode === "reschedule", retry: false,
  })
  const now = new Date()
  const future = new Date(booking.startsAt) > now
  const ended = new Date(booking.endsAt) <= now
  const hosts = booking.availableHosts ?? context.hosts.filter((host) => host.isActive && (context.writableHostIds === null || context.writableHostIds.includes(host.id)))
  async function submit() {
    if (!mode) return
    setBusy(true); setError("")
    const payload = { operation: mode, version: booking.version, reason, note, notifyCustomer, ...(mode === "reschedule" ? { startsAt, hostUserId: hostId } : {}), ...(mode === "outcome" ? { outcome } : {}) }
    try {
      const identity = await bookingRequestIdentity(`staff:${booking.id}`, payload)
      const response = await fetch(`/api/v1/bookings/${encodeURIComponent(booking.id)}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: identity.idempotencyKey }) })
      const body = await response.json()
      if (!response.ok || !body.success) { setError(t(BOOKING_ERROR_KEYS[body.code] ?? "errSave")); return }
      setMode(null); onSaved()
    } catch { setError(t("commandUnconfirmed")) } finally { setBusy(false) }
  }
  if (!booking.canManage) return null
  return <section className="space-y-3 border-t pt-4" aria-label={t("meetingActions")}>
    {!mode ? <div className="flex flex-wrap gap-2">
      {booking.status === "confirmed" && future ? <><Button variant="outline" onClick={() => setMode("reschedule")}>{t("rescheduleMeeting")}</Button><Button variant="ghost" onClick={() => setMode("cancel")}>{t("cancelLink")}</Button></> : null}
      {ended && booking.status !== "cancelled" && (booking.status === "confirmed" || booking.canCorrect) ? <Button variant="outline" onClick={() => setMode("outcome")}>{t(booking.status === "confirmed" ? "recordOutcome" : "correctOutcome")}</Button> : null}
    </div> : <div className="space-y-4 rounded-xl border p-4">
      <h3 className="font-medium">{t(mode === "reschedule" ? "rescheduleMeeting" : mode === "cancel" ? "cancelTitle" : "recordOutcome")}</h3>
      {mode === "reschedule" ? <>
        <div className="space-y-1"><Label htmlFor="move-host">{t("colHosts")}</Label><select id="move-host" value={hostId} disabled={busy} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" onChange={(event) => { setHostId(event.target.value); setStartsAt("") }}>{hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="move-day">{t("chooseDay")}</Label><Input id="move-day" type="date" value={day} disabled={busy} onChange={(event) => { if (event.target.value) { setDay(event.target.value); setStartsAt("") } }} /></div>
        {availability.isFetching ? <p role="status" className="text-sm">{t("checkingSlots")}</p> : availability.isError ? <p role="alert" className="text-sm text-destructive">{t(BOOKING_ERROR_KEYS[availability.error.message] ?? "errLoad")}</p> : !availability.data?.days.length ? <p className="text-sm text-muted-foreground">{t("noSlotsTitle")}</p> : <div className="flex flex-wrap gap-2" role="group" aria-label={t("chooseTime")}>{availability.data.days.flatMap((item) => item.slots).map((slot) => <Button key={slot.startsAt} type="button" variant={startsAt === slot.startsAt ? "default" : "outline"} aria-pressed={startsAt === slot.startsAt} disabled={busy} onClick={() => setStartsAt(slot.startsAt)}>{formatTime(slot.startsAt, locale, { hour: "2-digit", minute: "2-digit", timeZone: context.timezone })}</Button>)}</div>}
      </> : null}
      {mode === "outcome" ? <><div className="space-y-1"><Label htmlFor="meeting-outcome">{t("workspaceStatus")}</Label><select id="meeting-outcome" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={outcome} disabled={busy} onChange={(event) => setOutcome(event.target.value)}><option value="completed">{t("meetingCompleted")}</option><option value="no_show">{t("meetingNoShow")}</option></select></div><div className="space-y-1"><Label htmlFor="meeting-outcome-note">{t("outcomeNote")}</Label><Textarea id="meeting-outcome-note" value={note} maxLength={2000} disabled={busy} onChange={(event) => setNote(event.target.value)} /></div></> : null}
      <div className="space-y-1"><Label htmlFor="meeting-change-reason">{t("changeReason")}</Label><Textarea id="meeting-change-reason" value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></div>
      {booking.email && mode !== "outcome" ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={notifyCustomer} disabled={busy} onChange={(event) => setNotifyCustomer(event.target.checked)} />{t("notifyCustomer")}</label> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button onClick={() => void submit()} disabled={busy || mode === "reschedule" && (!startsAt || availability.isFetching || availability.isError)}>{busy ? t("saving") : t("saveMeeting")}</Button><Button variant="ghost" disabled={busy} onClick={() => { setMode(null); setError("") }}>{t("cancel")}</Button></div>
    </div>}
  </section>
}
