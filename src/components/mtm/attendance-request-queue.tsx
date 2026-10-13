"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { createDateFormatter } from "@/lib/format-date"
import { ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"] as const
const LABELS = { PENDING: "requestsPending", APPROVED: "requestsApproved", REJECTED: "requestsRejected", CANCELLED: "requestsCancelled", ALL: "requestsAll" } as const

export function MtmAttendanceRequestQueue() {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("PENDING")
  const [items, setItems] = useState<AttendanceReviewItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const writing = useRef(false)
  const current = items.find((item) => item.id === selected)
  const stamp = (value: string, timezone: string) => createDateFormatter(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  const load = useCallback(async (after?: string) => {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setBusy(true); setMessage(null); setSelected(null); setNote("")
    if (!after) setItems([])
    try {
      const query = new URLSearchParams({ status, ...(after ? { cursor: after } : {}) })
      const response = await fetch(`/api/v1/mtm/attendance/requests?${query}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.items)) {
        if ([401, 403, 404].includes(response.status)) setItems([])
        setMessage(t([401, 403, 404].includes(response.status) ? "requestsForbidden" : "requestsLoadError")); setCursor(null); return
      }
      setItems((previous) => after ? [...previous, ...body.data.items.filter((row: AttendanceReviewItem) => !previous.some((old) => old.id === row.id))] : body.data.items)
      setCursor(body.data.nextCursor); setUnknown(false)
    } catch { if (!controller.signal.aborted) setMessage(t("requestsLoadError")) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }, [status, t])
  useEffect(() => {
    if (writing.current) { writing.current = false; setUnknown(true) }
    void load()
    return () => active.current?.abort()
  }, [load])

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!current || busy || writing.current || unknown) return
    const controller = new AbortController(); active.current?.abort(); active.current = controller
    writing.current = true; setBusy(true); setMessage(null)
    try {
      const response = await fetch(`/api/v1/mtm/attendance/requests/${encodeURIComponent(current.id)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ decision, version: current.version, note: note.trim() || null }),
      })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (response.ok && body?.success === true && body.data?.request) {
        const result = body.data.request
        setItems((previous) => previous.flatMap((row) => row.id !== current.id ? [row] : status === "ALL" ? [{ ...row, ...result }] : []))
        setSelected(null); setNote(""); setMessage(t("requestsSaved"))
      } else if ([401, 403, 404].includes(response.status)) {
        setItems([]); setCursor(null); setSelected(null); setMessage(t("requestsForbidden"))
      } else {
        setUnknown(true); setMessage(t(response.status === 409 ? "requestsChanged" : "requestsUnknown"))
      }
    } catch { if (!controller.signal.aborted) { setUnknown(true); setMessage(t("requestsUnknown")) } }
    finally { if (!controller.signal.aborted) { writing.current = false; setBusy(false) } }
  }

  return <section className="space-y-5" data-testid="attendance-request-queue" aria-label={t("requestsTitle")} aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/mtm/attendance" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">{t("requestsBack")}</Link><Link href="/mtm/attendance/recordings" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium text-primary hover:bg-muted">{t("hrRecordingTitle")}</Link></div>
    <HomeCard testId="attendance-request-card" titleId="attendance-request-title" tone="amber" icon={<ClipboardList className="h-5 w-5" />} title={t("requestsTitle")}>
      <p className="pt-4 text-sm text-muted-foreground">{t("requestsDescription")}</p>
      <div className="flex flex-wrap items-end gap-3 py-4">
        <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block font-medium">{t("requestsTitle")}</span>
          <select aria-label={t("requestsTitle")} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-h-11 w-full rounded-lg border bg-background px-3">
            {STATUSES.map((value) => <option key={value} value={value}>{t(LABELS[value])}</option>)}
          </select>
        </label>
        <Button className="min-h-11" variant="outline" onClick={() => void load()} disabled={busy}>{t("requestsRefresh")}</Button>
      </div>
      {message && <p role="status" className="py-3 text-sm">{message}</p>}
      {!busy && !message && items.length === 0 && <p className="py-8 text-sm text-muted-foreground">{t("requestsEmpty")}</p>}
      <ul className="divide-y divide-border">
        {items.map((item) => <li key={item.id} className="py-4" data-testid={`attendance-request-${item.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 basis-full space-y-1 sm:flex-1 sm:basis-0">
              <p className="font-semibold">{item.employeeName} <span className="font-normal text-muted-foreground">{item.teamName}</span></p>
              <p className="text-sm">{item.details.kind === "TIME_CORRECTION" ? t("requestsTimeCorrection") : attendanceDayKindLabel(item.details.dayKind, locale)} · {item.startDate}{item.endDate !== item.startDate ? ` — ${item.endDate}` : ""}{item.details.unit === "HOURS" ? ` · ${item.details.startTime}–${item.details.endTime}` : ""}</p>
              {item.details.kind === "HR_RECORD" && <p className="text-xs font-medium text-muted-foreground">{t("hrRecordingCard")}</p>}
              <p className="text-xs text-muted-foreground">{t("requestsSubmitted", { date: stamp(item.submittedAt, item.details.timezone) })}</p>
            </div>
            <HomePill tone={item.status === "PENDING" ? "amber" : item.status === "APPROVED" ? "green" : "zinc"}>{t(LABELS[item.status])}</HomePill>
            <Button className="min-h-11" variant="outline" disabled={busy} aria-expanded={item.id === selected} aria-controls={`attendance-request-details-${item.id}`} onClick={() => { setSelected(item.id === selected ? null : item.id); setNote("") }}>{t(item.id === selected ? "requestsClose" : "requestsOpen")}</Button>
          </div>
          {item.id === selected && <div id={`attendance-request-details-${item.id}`} className="mt-4 space-y-4 rounded-lg bg-muted/40 p-4">
            <div><h3 className="text-sm font-semibold">{t("requestsReason")}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.reason}</p></div>
            {item.details.attachmentIds.length > 0 && <div><h3 className="text-sm font-semibold">{t("requestsDocuments")}</h3><div className="mt-2 flex flex-wrap gap-3">{item.details.attachmentIds.map((id, index) => <a key={id} href={`/api/v1/mtm/attendance/attachments/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center text-sm text-primary underline" target="_blank" rel="noopener noreferrer">{t("requestsDocument", { number: index + 1 })}</a>)}</div></div>}
            {item.decisionNote && <p className="whitespace-pre-wrap break-words text-sm">{item.decisionNote}</p>}
            {item.decidedAt && <p className="text-xs text-muted-foreground">{t("requestsDecision", { name: item.reviewerName ?? "—", date: stamp(item.decidedAt, item.details.timezone) })}</p>}
            {item.status === "PENDING" && <><label className="block text-sm font-medium">{t("requestsNote")}<textarea className="mt-2 min-h-24 w-full rounded-lg border bg-background p-3 font-normal" value={note} maxLength={1000} disabled={busy || unknown} onChange={(event) => setNote(event.target.value)} /></label><p className="text-xs text-muted-foreground">{t("requestsNoteHint")}</p>
              <div className="flex flex-wrap gap-3"><Button className="min-h-11" onClick={() => void decide("APPROVED")} disabled={busy || unknown}>{t(busy ? "requestsSaving" : "requestsApprove")}</Button><Button className="min-h-11" variant="outline" onClick={() => void decide("REJECTED")} disabled={busy || unknown || note.trim().length < 3}>{t("requestsReject")}</Button></div></>}
          </div>}
        </li>)}
      </ul>
      {cursor && <Button variant="outline" className="my-4 min-h-11" disabled={busy} onClick={() => void load(cursor)}>{t("requestsMore")}</Button>}
    </HomeCard>
  </section>
}
