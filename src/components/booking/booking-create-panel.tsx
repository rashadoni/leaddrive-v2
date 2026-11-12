"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useBookingWords } from "./booking-words"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Clock3, TriangleAlert } from "lucide-react"
import { CrmSection } from "@/components/ui/crm-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BookingScheduler, type BookResult, type BookingRequest, type PublicBookingPage } from "./booking-scheduler"
import { BOOKING_ERROR_KEYS } from "./booking-meeting-actions"
import { bookingRequestIdentity, completeBookingRequest } from "@/lib/booking/client-identity"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { groupByCategory, servicePriceLabel } from "@/lib/booking/service"
import { cn } from "@/lib/utils"
import type { DaySlots } from "@/lib/booking/availability"

const FIELD = "min-h-11 w-full rounded-[10px] border border-input bg-card px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const FIELD_LABEL = "text-xs font-semibold text-muted-foreground"

/** A free time offered instead of one that clashes. */
export interface BookingAlternative {
  startsAt: string
  time: string
  meta: string
}

/** One line of «before you book» — a fact the screen already knows. */
export interface BookingReadiness {
  key: string
  label: string
  meta: string
  waiting?: boolean
}

export function BookingCreatePanel({ pages, hosts, timezone, onSaved, initial, onStartChange, clash, alternatives, onPickAlternative, checks }: {
  pages: { id: string; title: string; hostIds: string[]; category?: string | null }[]
  hosts: { id: string; name: string }[]
  timezone: string
  onSaved: (id: string) => void
  /** A free window the day's rail was clicked on: page, host, day and time. */
  initial?: { pageId?: string; hostId?: string; day?: string; startsAt?: string }
  /** Lets the day's rail draw the time being taken while the form is filled. */
  onStartChange?: (startsAt: string | null) => void
  /** The meeting the chosen time lands on, when it lands on one. */
  clash?: { name: string; from: string; to: string; minutes: number } | null
  alternatives?: BookingAlternative[]
  onPickAlternative?: (startsAt: string) => void
  checks?: BookingReadiness[]
}) {
  const words = useBookingWords()
  const t = useTranslations("booking"), locale = useLocale()
  const presetPage = initial?.pageId
  const [pageId, setPageId] = useState(presetPage && pages.some((page) => page.id === presetPage) ? presetPage : pages[0]?.id ?? "")
  const [hostId, setHostId] = useState(initial?.hostId ?? "")
  const [day, setDay] = useState(() => initial?.day ?? dateInputValueInTimezone(new Date(), timezone))
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
  const groups = groupByCategory(pages, locale)
  // What this service costs and how long it takes, where the service is
  // chosen: the staff form hides the customer's summary that says it.
  const chosen = available.data?.page
  const price = servicePriceLabel(chosen, locale)
  const serviceMeta = chosen ? [t("minutes", { count: chosen.durationMinutes }), price].filter(Boolean).join(" · ") : ""
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
  return <div className="space-y-4">
    {!pages.length ? <p className="text-sm">{t("noAvailablePages")}</p> : <>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL} htmlFor="create-meeting-page">{words.vocabulary.item ?? t("colPage")}</Label>
        <select id="create-meeting-page" className={FIELD} value={pageId} onChange={(event) => { setPageId(event.target.value); setHostId(""); onStartChange?.(null) }}>
          {/* A salon with twenty services reads them by group; one that never
              filed them sees the plain list it had before. */}
          {groups.length > 1 || groups[0]?.category ? groups.map((group) => <optgroup key={group.category ?? "__none"} label={group.category ?? t("categoryNone")}>
            {group.items.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
          </optgroup>) : pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
        </select>
        {serviceMeta ? <p className="text-xs font-semibold text-muted-foreground">{serviceMeta}</p> : null}
      </div>
      <div className="space-y-1.5"><Label className={FIELD_LABEL} htmlFor="create-meeting-host">{t("colHosts")}</Label><select id="create-meeting-host" className={FIELD} value={hostId} onChange={(event) => { setHostId(event.target.value); onStartChange?.(null) }}><option value="">{t("automaticHost")}</option>{hosts.filter((host) => pages.find((page) => page.id === pageId)?.hostIds.includes(host.id)).map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select></div>
      <div className="space-y-1.5"><Label className={FIELD_LABEL} htmlFor="create-meeting-day">{t("chooseDay")}</Label><Input type="date" id="create-meeting-day" className={cn(FIELD, clash ? "border-destructive ring-2 ring-destructive/20" : "")} value={day} onChange={(event) => { if (event.target.value) { setDay(event.target.value); onStartChange?.(null) } }} /></div>

      {/* The clash and the way out of it, together: a warning with no free time
          beside it leaves the person to hunt the rail for one. */}
      {clash ? <div className="rounded-xl bg-destructive/[0.06] p-4">
        <p className="flex items-start gap-2.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0">
            <span className="block break-words text-sm font-bold text-destructive">{t("clashTitle", { name: clash.name, time: clash.from })}</span>
            <span className="mt-1 block text-[13px] text-muted-foreground">{t("clashHint", { minutes: clash.minutes })}</span>
          </span>
        </p>
        {alternatives?.length ? <>
          <p className="mb-2 mt-3 text-[13px] font-semibold text-muted-foreground">{t("clashOpenTimes")}</p>
          <div className="grid grid-cols-3 gap-2">
            {alternatives.slice(0, 3).map((item) => <button
              key={item.startsAt}
              type="button"
              onClick={() => onPickAlternative?.(item.startsAt)}
              className="min-h-11 rounded-[10px] border border-border bg-card px-1 py-2 text-center transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-sm font-bold tabular-nums">{item.time}</span>
              <span className="block text-[11px] text-muted-foreground">{item.meta}</span>
            </button>)}
          </div>
        </> : null}
      </div> : null}

      {checks?.length ? <div>
        <p className="mb-2 mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t("beforeBooking")}</p>
        <ul className="space-y-1.5">
          {checks.map((check) => <li key={check.key} className="flex items-center gap-2.5 text-sm">
            {check.waiting
              ? <Clock3 aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-amber-600 dark:text-amber-400" />
              : <CheckCircle2 aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" />}
            <span className="min-w-0 flex-1 break-words font-semibold">{check.label}</span>
            <span className="shrink-0 text-right text-xs text-muted-foreground">{check.meta}</span>
          </li>)}
        </ul>
      </div> : null}

      {error ? <CrmSection role="alert" tone="destructive"><p className="flex items-start gap-2.5 text-sm"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />{error}</p></CrmSection> : null}
      {available.isFetching ? <p role="status" className="text-sm text-muted-foreground">{t("checkingSlots")}</p> : available.isError ? <p role="alert" className="text-sm text-destructive">{t(BOOKING_ERROR_KEYS[available.error.message] ?? "errLoad")}</p> : available.data ? <BookingScheduler key={`${pageId}:${day}:${hostId}`} page={available.data.page} days={available.data.days} onBook={book} staff initialStartsAt={initial?.startsAt ?? null} onStartChange={onStartChange} /> : null}
    </>}
  </div>
}
