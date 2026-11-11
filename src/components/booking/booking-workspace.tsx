"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { CalendarCheck, CalendarDays, CalendarPlus, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, List, RefreshCw, Search, SlidersHorizontal } from "lucide-react"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BookingPagesPanel } from "./booking-pages-panel"
import { BookingDayLegend, BookingDaySummary, BookingDayTimeline, BookingHostChips, BookingWeekStrip, mergeFreeWindows, minutesFrom, spansClashing, subtractSpans, type TimelineBusy, type TimelineMeeting, type TimelineSpan, type TimelineWindow } from "./booking-day-timeline"
import { BookingDetail, type DayScheduleRow } from "./booking-detail"
import { type BookingHistoryItem } from "./booking-history"
import { BookingCreatePanel, type BookingAlternative, type BookingReadiness } from "./booking-create-panel"
import { BookingCoordinatorsPanel } from "./booking-coordinators-panel"
import { BookingRequestsPanel } from "./booking-requests-panel"
import { BookingHostSchedulePanel } from "./booking-host-schedule-panel"
import { BookingStatus } from "./booking-status"
import type { DaySlots } from "@/lib/booking/availability"
import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { formatDate, formatTime } from "@/lib/format-date"

export interface WorkspaceBooking {
  id: string
  version: number
  availableHosts?: { id: string; name: string }[]
  phoneRestricted?: boolean
  canCreateFollowUp?: boolean
  canManage?: boolean
  canCorrect?: boolean
  outcomeNote?: string | null
  cancellationReason?: string | null
  legacyDetails?: boolean
  history?: BookingHistoryItem[]
  historyNextCursor?: number | null
  historyLimited?: boolean
  integrations?: { type: string; status: string; count: number; requiresAttention?: boolean }[]
  bookingPageId: string
  hostUserId: string
  name: string
  phone: string
  email: string | null
  note: string | null
  startsAt: string
  endsAt: string
  status: string
  createdAt: string
  cancelledAt: string | null
  hostName: string | null
  calendarLinked: boolean
  bookingPage: { title: string; locationType: string; locationText: string | null; timezone?: string | null; price?: string | null; priceCurrency?: string | null; repeatCycleDays?: number | null }
  /** Where the meeting came from: «public_link», «staff» or «whatsapp». */
  source?: string
  /** What this visit was asked to leave to hold the time, and where it stands. */
  depositAmount?: string | null
  depositStatus?: string | null
  depositPaidAt?: string | null
  /** When the client themselves said they are coming, after a reminder. */
  clientConfirmedAt?: string | null
  remindedDayAt?: string | null
  remindedHourAt?: string | null
  /** A WhatsApp meeting: what the client wrote, what was offered, what they tapped. */
  whatsapp?: { asked: string; offered: string[]; chosen: string } | null
  leadId?: string | null
  /** The customer picked from the CRM when this meeting was booked. */
  contactId?: string | null
  taskId?: string | null
}
interface Context {
  writableHostIds: string[] | null
  timezone: string
  userId: string
  canConfigure: boolean
  canCoordinate: boolean
  hosts: { id: string; name: string; isActive: boolean; canReceiveBookings: boolean }[]
  pages: { id: string; title: string; hostIds: string[]; isActive: boolean; category: string | null; url: string }[]
}
interface BookingList { items: WorkspaceBooking[]; nextCursor: string | null }
async function readBookingData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(response.status === 403 ? "access" : "load")
  return body.data as T
}
const SELECT = "min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const STATUS_KEYS: Record<string, string> = { confirmed: "meetingConfirmed", cancelled: "meetingCancelled", completed: "meetingCompleted", no_show: "meetingNoShow" }

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}
function calendarWindow(month: string) {
  const first = `${month}-01`
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay()
  const start = addDays(first, -((weekday + 6) % 7))
  return { start, end: addDays(start, 42), days: Array.from({ length: 42 }, (_, index) => addDays(start, index)) }
}
/** The Monday-to-Sunday week the day sits in. */
function weekWindow(day: string) {
  const start = addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
  return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, index) => addDays(start, index)) }
}

/** The four screens of the section; each one is a page of its own. */
export type BookingSection = "meetings" | "pages" | "whatsapp" | "team"

/** Where each section lives, so the nav is links and the help video can differ per screen. */
export const BOOKING_SECTION_PATHS: Record<BookingSection, string> = {
  meetings: "/meetings",
  pages: "/meetings/services",
  whatsapp: "/meetings/whatsapp",
  team: "/meetings/team",
}

export function BookingWorkspace({ section = "meetings" }: { section?: BookingSection } = {}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const tab = section
  const selectedId = params.get("booking")
  const { data: session } = useSession()
  const identity = `${session?.user?.organizationId ?? ""}:${session?.user?.id ?? ""}`
  const contextQuery = useQuery({ queryKey: ["booking-context", identity], queryFn: ({ signal }) => readBookingData<Context>("/api/v1/bookings/context", signal), retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false })
  const context = contextQuery.data
  const [pagination, setPagination] = useState<{ key: string; cursor: string | null }>({ key: "", cursor: null })
  const [revision, setRevision] = useState(0)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState("day")
  const [period, setPeriod] = useState("upcoming")
  const [status, setStatus] = useState("all")
  const [host, setHost] = useState("")
  const [page, setPage] = useState("")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  /** The time a new meeting is being booked at, so the day's rail can show it. */
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  /** Search and status live behind the day card's settings button. */
  const [dayFilters, setDayFilters] = useState(false)
  /** The meeting just created, shown as a confirmation over the day. */
  const [justBooked, setJustBooked] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [instant, setInstant] = useState(() => new Date().toISOString())
  useEffect(() => { const timer = window.setInterval(() => setInstant(new Date().toISOString()), 60_000); return () => window.clearInterval(timer) }, [])
  const timezone = context?.timezone ?? "Asia/Baku"
  const today = dateInputValueInTimezone(instant, timezone)
  const [selectedMonth, setMonth] = useState<string | null>(null)
  const month = selectedMonth ?? today.slice(0, 7)
  const [day, setDay] = useState<string | null>(null)
  const contextReady = Boolean(context)
  const detailQuery = useQuery({
    queryKey: ["booking-detail", identity, selectedId, revision],
    queryFn: ({ signal }) => readBookingData<WorkspaceBooking>(`/api/v1/bookings/${encodeURIComponent(selectedId!)}`, signal),
    enabled: Boolean(selectedId) && contextReady, retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false,
  })
  const detail = detailQuery.isError ? null : detailQuery.data
  const detailError = detailQuery.isError ? t("meetingUnavailable") : ""
  // Opened straight on a meeting — from a task, or from a link someone sent —
  // the day shown is the meeting's own, until the week strip says otherwise.
  const detailDay = detail ? dateInputValueInTimezone(detail.startsAt, detail.bookingPage.timezone || timezone) : null
  const selectedDay = day ?? (view === "day" ? detailDay ?? today : `${month}-01`)
  const grid = calendarWindow(month)
  const week = weekWindow(selectedDay)
  const atMidnight = (value: string) => localDateTimeToUtc(`${value}T00:00`, timezone).toISOString()

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    router.replace(`/meetings${next.size ? `?${next}` : ""}`, { scroll: false })
  }
  function openMeeting(id: string) {
    setCreating(false)
    setPendingStart(null)
    // Pin the day on screen: without it the rail would jump to today while
    // the newly chosen card is still loading.
    setDay(selectedDay)
    navigate({ booking: id })
  }
  function closePanel() {
    setCreating(false)
    setPendingStart(null)
    navigate({ booking: null })
  }
  function startBooking(startsAt: string | null) {
    setPendingStart(startsAt)
    setDay(selectedDay)
    navigate({ booking: null })
    setCreating(true)
  }

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])

  const filters = new URLSearchParams({ status, limit: "50" })
  if (host) filters.set("host", host)
  if (page) filters.set("page", page)
  if (query) filters.set("search", query)

  const paginationKey = [period, status, host, page, query, selectedDay, view, timezone].join("|")
  const cursor = pagination.key === paginationKey ? pagination.cursor : null
  const setCursor = (next: string | null) => setPagination({ key: paginationKey, cursor: next })
  // The day view asks for every host's meetings and filters them here, so the
  // chips can say how busy each host is without one request per host.
  const request = new URLSearchParams(filters)
  if (view === "day") request.delete("host")
  if (view === "calendar" || view === "day") {
    request.set("from", atMidnight(selectedDay)); request.set("to", atMidnight(addDays(selectedDay, 1)))
  } else if (period === "today" || period === "week") {
    request.set("from", atMidnight(today)); request.set("to", atMidnight(addDays(today, period === "today" ? 1 : 7)))
  } else if (period === "upcoming") request.set("from", instant)
  if (cursor) request.set("cursor", cursor)
  const listQuery = useQuery({
    queryKey: ["bookings", identity, request.toString(), revision],
    queryFn: ({ signal }) => readBookingData<BookingList>(`/api/v1/bookings?${request}`, signal),
    enabled: contextReady && tab === "meetings", retry: false,
    refetchInterval: tab === "meetings" ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
  const countsWindow = view === "day" ? week : grid
  const calendarRequest = new URLSearchParams(filters)
  calendarRequest.set("from", atMidnight(countsWindow.start)); calendarRequest.set("to", atMidnight(countsWindow.end))
  const calendarQuery = useQuery({
    queryKey: ["booking-calendar", identity, calendarRequest.toString(), revision],
    queryFn: ({ signal }) => readBookingData<{ days: { day: string; count: number }[] }>(`/api/v1/bookings/calendar?${calendarRequest}`, signal),
    enabled: contextReady && tab === "meetings" && view !== "list", retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false,
  })
  // Free time belongs to one booking page: pages differ in length, hours and
  // who meets. The filter decides which one; with none chosen, the first page
  // a client could actually book, and the day card says which it is.
  const bookablePages = context?.pages.filter((item) => item.isActive && item.hostIds.length) ?? []
  const freePage = bookablePages.find((item) => item.id === page) ?? bookablePages[0] ?? null
  async function copyClientLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      window.prompt(t("copyLink"), url)
    }
  }
  const slotsRequest = freePage ? new URLSearchParams({ pageId: freePage.id, day: selectedDay, ...(host ? { hostId: host } : {}) }).toString() : ""
  const slotsQuery = useQuery({
    queryKey: ["booking-day-slots", identity, slotsRequest, revision],
    queryFn: ({ signal }) => readBookingData<{ page: { durationMinutes: number }; days: DaySlots[]; busy: { hostId: string; intervals: { start: string; end: string }[] }[] }>(`/api/v1/bookings/availability?${slotsRequest}`, signal),
    enabled: contextReady && tab === "meetings" && view === "day" && Boolean(slotsRequest), retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false,
  })
  // What this host's own Outlook or Google calendar has that day. Only for
  // the host the rail actually shows: one request, not one per colleague.
  const soleHostId = host || (context?.hosts.filter((item) => item.isActive && item.canReceiveBookings).length === 1 ? context.hosts.find((item) => item.isActive && item.canReceiveBookings)!.id : "")
  const externalQuery = useQuery({
    queryKey: ["booking-external", identity, soleHostId, selectedDay, revision],
    queryFn: ({ signal }) => readBookingData<{ events: { start: string; end: string; provider: "google" | "microsoft"; title: string | null }[]; unavailable: boolean }>(`/api/v1/bookings/external-events?hostId=${encodeURIComponent(soleHostId)}&day=${selectedDay}`, signal),
    enabled: contextReady && tab === "meetings" && view === "day" && Boolean(soleHostId), retry: false,
    refetchInterval: 60_000, refetchIntervalInBackground: false,
  })
  const loaded = listQuery.isError ? [] : listQuery.data?.items ?? []
  const items = view === "day" && host ? loaded.filter((item) => item.hostUserId === host) : loaded
  const nextCursor = listQuery.data?.nextCursor ?? null
  const loading = contextQuery.isPending || (tab === "meetings" && listQuery.isFetching)
  const failure = contextQuery.error ?? listQuery.error
  const error = failure ? t(failure.message === "access" ? "workspaceForbidden" : "errLoad") : ""
  const calendarLoading = calendarQuery.isFetching
  const calendarError = calendarQuery.isError
  const counts: Record<string, number> = Object.fromEntries((calendarQuery.data?.days ?? []).map((row) => [row.day, row.count]))

  const date = (value: string) => formatDate(value, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })
  const time = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })
  const state = (value: string) => t(STATUS_KEYS[value] ?? "meetingUnknownStatus")
  function moveMonth(amount: number) {
    const value = new Date(`${month}-01T12:00:00Z`)
    value.setUTCMonth(value.getUTCMonth() + amount)
    setMonth(value.toISOString().slice(0, 7)); setDay(null); setCursor(null)
  }

  // Everything the day's rail draws is measured in minutes from this instant.
  const dayStartMs = Date.parse(atMidnight(selectedDay))
  const railTime = (minutes: number) => time(new Date(dayStartMs + minutes * 60_000).toISOString())
  const duration = (minutes: number) => minutes < 60
    ? t("minutes", { count: minutes })
    : minutes % 60 === 0 ? t("durationH", { hours: minutes / 60 }) : t("durationHm", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  const dayMeetings: TimelineMeeting[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    subtitle: `${item.hostName ?? t("hostUnknown")} · ${item.bookingPage.title}`,
    start: minutesFrom(dayStartMs, item.startsAt),
    end: minutesFrom(dayStartMs, item.endsAt),
    reminded: Boolean(item.remindedDayAt || item.remindedHourAt),
    confirmed: Boolean(item.clientConfirmedAt),
  }))
  const freeWindows = mergeFreeWindows(slotsQuery.data?.days.find((item) => item.date === selectedDay)?.slots ?? [], dayStartMs)
  const slotMinutes = slotsQuery.data?.page.durationMinutes ?? 30
  const pendingMinutes = pendingStart ? minutesFrom(dayStartMs, pendingStart) : null
  const pendingOnDay = pendingMinutes !== null && pendingMinutes >= 0 && pendingMinutes < 24 * 60 ? pendingMinutes : null
  const pendingSpan = pendingOnDay === null ? null : { start: pendingOnDay, end: pendingOnDay + slotMinutes }
  const canBook = Boolean(freePage)
  const dayStatuses = Object.keys(STATUS_KEYS).filter((value) => dayMeetings.some((meeting) => meeting.status === value))
  const hostsBooking = context?.hosts.filter((item) => item.isActive && item.canReceiveBookings) ?? []
  // Grey «busy» blocks name one person's time, so they are drawn only where
  // the rail shows one person: a host was chosen, or the team is one host.
  const soleHost = host || (hostsBooking.length === 1 ? hostsBooking[0].id : "")
  // The same hours, named where they came from a calendar this reader may
  // see: the free slots already treat them as taken, and a block that says
  // «Planning · Outlook» is the difference between one window and two.
  const externalEvents = (externalQuery.data?.events ?? []).map((event) => ({
    start: minutesFrom(dayStartMs, event.start),
    end: minutesFrom(dayStartMs, event.end),
    label: event.title ?? "",
    source: event.provider,
  }))
  const fromCalendar = (span: TimelineSpan) => externalEvents.find((event) => event.start <= span.start && event.end >= span.end)
  const busySpans: TimelineBusy[] = soleHost ? (slotsQuery.data?.busy.find((row) => row.hostId === soleHost)?.intervals ?? [])
    .flatMap((interval) => subtractSpans(
      { start: Math.max(0, minutesFrom(dayStartMs, interval.start)), end: Math.min(24 * 60, minutesFrom(dayStartMs, interval.end)) },
      dayMeetings.filter((meeting) => meeting.status !== "cancelled"),
    ))
    .filter((span) => span.end - span.start >= 15)
    .map((span) => {
      const event = fromCalendar(span)
      return event ? { ...span, label: event.label, source: event.source } : span
    }) : []
  const hostChips = hostsBooking.map((item) => {
    const count = loaded.filter((row) => row.hostUserId === item.id && row.status !== "cancelled").length
    return { id: item.id, name: item.name, count, meta: t("dayCount", { count }) }
  })

  // What the chosen time lands on, and the free windows that would not.
  const clashing = spansClashing(pendingSpan, dayMeetings.filter((meeting) => meeting.status !== "cancelled"))
  const clash = pendingSpan && clashing.length ? {
    name: clashing[0].name,
    from: railTime(clashing[0].start),
    to: railTime(clashing[0].end),
    minutes: Math.max(1, Math.min(pendingSpan.end, clashing[0].end) - Math.max(pendingSpan.start, clashing[0].start)),
  } : null
  const alternatives: BookingAlternative[] = freeWindows
    .filter((window: TimelineWindow) => !spansClashing({ start: window.start, end: window.start + slotMinutes }, dayMeetings.filter((meeting) => meeting.status !== "cancelled")).length)
    .slice(0, 3)
    .map((window: TimelineWindow) => ({ startsAt: window.startsAt, time: railTime(window.start), meta: duration(window.end - window.start) }))
  const checks: BookingReadiness[] = freePage ? [
    { key: "page", label: t("checkPage"), meta: freePage.title },
    { key: "host", label: t("checkHost"), meta: host ? hostsBooking.find((item) => item.id === host)?.name ?? t("automaticHost") : t("automaticHost") },
    { key: "notify", label: t("checkNotify"), meta: t("afterBooking"), waiting: true },
  ] : []

  // The host's whole day beside the meeting that is open, free time included:
  // the question after "who is this" is "what else is on that day".
  const scheduleHost = detail?.hostUserId
  const schedule: (DayScheduleRow & { start: number })[] = detail && detailDay === selectedDay ? [
    ...loaded.filter((item) => item.hostUserId === scheduleHost && item.status !== "cancelled")
      .map((item) => ({ id: item.id, start: Date.parse(item.startsAt), time: time(item.startsAt), name: item.name, subtitle: `${item.bookingPage.title} · ${duration(Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000))}`, current: item.id === detail.id })),
    ...freeWindows.map((window) => ({ id: null, start: dayStartMs + window.start * 60_000, time: railTime(window.start), name: t("freeWindow"), subtitle: duration(window.end - window.start), current: false })),
  ].sort((left, right) => left.start - right.start) : []

  const createPanel = context ? <BookingCreatePanel
    pages={bookablePages}
    hosts={hostsBooking}
    timezone={timezone}
    initial={{ pageId: freePage?.id, hostId: host || undefined, day: view === "day" ? selectedDay : undefined, startsAt: pendingStart ?? undefined }}
    onStartChange={view === "day" ? setPendingStart : undefined}
    clash={view === "day" ? clash : null}
    alternatives={view === "day" ? alternatives : undefined}
    onPickAlternative={view === "day" ? setPendingStart : undefined}
    checks={view === "day" ? checks : undefined}
    onSaved={(id) => { setCreating(false); setPendingStart(null); navigate({ booking: id }); setRevision((value) => value + 1); if (view === "day") setJustBooked(id) }}
  /> : null
  const detailPanel = (onClose?: () => void, rows?: DayScheduleRow[]) => detailError
    ? <CrmSection role="alert" tone="destructive">{detailError}</CrmSection>
    : !detail ? <p role="status" className="text-muted-foreground">{t("workspaceLoading")}</p>
      : context ? <BookingDetail booking={detail} context={context} identity={identity} schedule={rows} onSaved={() => setRevision((value) => value + 1)} onClose={onClose} onOpenMeeting={openMeeting} /> : null

  const viewSwitch = <div data-crm-tabs="" className="flex gap-1 border-b" role="group" aria-label={t("workspaceView")}>
    {([["day", t("viewDay"), CalendarRange], ["list", t("viewList"), List], ["calendar", t("viewCalendar"), CalendarDays]] as const).map(([value, label, Icon]) => <Button key={value} data-crm-tab="" data-state={view === value ? "active" : "inactive"} variant={view === value ? "secondary" : "ghost"} aria-pressed={view === value} onClick={() => { setView(value); setPendingStart(null); setDayFilters(false); setDay(value === "list" ? null : today) }}><Icon className="h-4 w-4" />{label}</Button>)}
  </div>
  const searchField = <div className="min-w-44 flex-1 space-y-1"><Label htmlFor="meeting-search">{t("workspaceSearch")}</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="meeting-search" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" placeholder={t("workspaceSearchHint")} /></div></div>
  const statusField = <div className="space-y-1"><Label htmlFor="meeting-state">{t("workspaceStatus")}</Label><select id="meeting-state" className={`${SELECT} block`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t("allStatuses")}</option>{Object.keys(STATUS_KEYS).map((value) => <option key={value} value={value}>{state(value)}</option>)}</select></div>
  const pageField = context && context.pages.length > 1 ? <div className="space-y-1"><Label htmlFor="meeting-page">{t("colPage")}</Label><select id="meeting-page" className={`${SELECT} block max-w-60`} value={page} onChange={(event) => setPage(event.target.value)}><option value="">{t("allPages")}</option>{context.pages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></div> : null

  return <main className="space-y-5 [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11" data-testid="booking-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("workspaceTitle")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("workspaceHint")}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {tab === "meetings" ? viewSwitch : null}
        {bookablePages.length && !creating ? <Button onClick={() => startBooking(null)}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{t("createMeeting")}</Button> : null}
        <Button variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }} disabled={loading} aria-label={t("refresh")}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}</Button>
      </div>
    </header>
    {/* Links, not a switch inside one page: each screen is its own address, so
        the browser remembers it, it can be sent to a colleague, and the help
        video belongs to the screen a person actually opened. */}
    <nav data-crm-tabs="" className="flex flex-wrap gap-1 border-b" aria-label={t("workspaceSections")}>
      {(["meetings", ...(context?.canConfigure ? ["pages", "whatsapp", "team"] : [])] as BookingSection[]).map((item) => <Button
        key={item}
        asChild
        data-crm-tab=""
        data-state={tab === item ? "active" : "inactive"}
        variant={tab === item ? "secondary" : "ghost"}
        className="min-h-11 rounded-b-none"
      >
        <Link href={BOOKING_SECTION_PATHS[item]} aria-current={tab === item ? "page" : undefined}>
          {t(item === "meetings" ? "workspaceMeetings" : item === "pages" ? "workspacePages" : item === "whatsapp" ? "waBookingTitle" : "workspaceTeam")}
        </Link>
      </Button>)}
    </nav>
    {/* The one thing a salon needs on the screen it opens: the link it sends to
        clients. It used to live one screen away, behind «Dəyiş» on a service
        card — the owner's point about the section being hard to understand
        starts here (2026-11-10: «не забудь про простоту в понимании»). */}
    {tab === "meetings" && context ? <CrmSection className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      {freePage ? <>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("myLinkTitle")}</p>
          <p className="truncate text-sm font-medium">{freePage.url.replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyClientLink(freePage.url)}>
            {linkCopied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {linkCopied ? t("linkCopied") : t("copyLink")}
          </Button>
          <Button variant="ghost" size="sm" asChild><a href={freePage.url} target="_blank" rel="noopener noreferrer">{t("openPage")}</a></Button>
          {context.canConfigure ? <Button variant="ghost" size="sm" asChild><Link href={BOOKING_SECTION_PATHS.pages}>{t("myLinkAll")}</Link></Button> : null}
        </div>
      </> : <>
        <p className="text-sm text-muted-foreground">{t("myLinkNone")}</p>
        {context.canConfigure
          ? <Button className="ml-auto" size="sm" asChild><Link href={BOOKING_SECTION_PATHS.pages}>{t("newPage")}</Link></Button>
          : <p className="ml-auto text-sm text-muted-foreground">{t("myLinkAsk")}</p>}
      </>}
    </CrmSection> : null}
    {tab === "pages" || tab === "whatsapp" ? context?.canConfigure ? <BookingPagesPanel show={tab === "whatsapp" ? "whatsapp" : "services"} /> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : tab === "team" ? context?.canConfigure ? <div className="grid items-start gap-5 lg:grid-cols-2"><BookingHostSchedulePanel /><BookingCoordinatorsPanel /></div> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : <>
      <BookingRequestsPanel timezone={timezone} onReviewed={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }} />
      {view === "day" ? null : <section className="flex flex-wrap items-end gap-3" aria-label={t("workspaceFilters")}>
        {searchField}
        {view === "list" ? <div className="space-y-1"><Label htmlFor="meeting-period">{t("workspacePeriod")}</Label><select id="meeting-period" className={`${SELECT} block`} value={period} onChange={(event) => { setPeriod(event.target.value); setDay(null) }}>{["upcoming", "today", "week", "all"].map((value) => <option key={value} value={value}>{t(`period_${value}`)}</option>)}</select></div> : null}
        {statusField}
        {/* In the day view the hosts are chips inside the day card: the number
            of meetings beside each name is the reason to pick one, and a
            closed select hides every number. */}
        {context?.canCoordinate ? <div className="space-y-1"><Label htmlFor="meeting-host">{t("colHosts")}</Label><select id="meeting-host" className={`${SELECT} block max-w-60`} value={host} onChange={(event) => setHost(event.target.value)}><option value="">{t("availableTeam")}</option><option value={context.userId}>{t("myMeetings")}</option>{context.hosts.filter((item) => item.id !== context.userId).map((item) => <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ` · ${t("hostInactive")}` : ""}</option>)}</select></div> : <p className="pb-3 text-sm text-muted-foreground">{t("myMeetings")}</p>}
        {pageField}
      </section>}
      {view === "day" ? null : <p className="text-xs text-muted-foreground">{t("timezoneNote", { zone: timezone })}</p>}
      {view === "day" ? <section aria-label={t("viewDay")}>
        {error ? <CrmSection role="alert" tone="destructive"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }}>{t("retry")}</Button></CrmSection> : <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
          <CrmSection aria-busy={loading}>
            {/* The card carries its own controls, so the two columns start
                right under the page title instead of a third of the way down
                behind a row of filters. */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold first-letter:uppercase">{formatDate(atMidnight(selectedDay), locale, { weekday: "long", day: "numeric", month: "long", timeZone: timezone })}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{freePage ? t("dayPageLine", { page: freePage.title, minutes: slotMinutes, zone: timezone }) : t("timezoneNote", { zone: timezone })}</p>
                <BookingDaySummary meetings={dayMeetings} windows={freeWindows} external={busySpans.filter((span) => span.source)} duration={duration} busyHint={t("busyHint")} windowsHint={freePage ? t("windowsHint", { page: freePage.title }) : ""} />
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {selectedDay === today ? null : <Button variant="outline" size="sm" onClick={() => { setDay(today); setPendingStart(null) }}>{t("jumpToday")}</Button>}
                <Hint text={t("dayFiltersHint")}>
                  <Button variant="outline" size="icon" aria-expanded={dayFilters} aria-label={t("workspaceFilters")} onClick={() => setDayFilters((open) => !open)}><SlidersHorizontal className="h-4 w-4" /></Button>
                </Hint>
              </div>
            </div>
            {dayFilters ? <section className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-muted/50 p-3" aria-label={t("workspaceFilters")}>
              {searchField}
              {statusField}
              {pageField}
            </section> : null}
            <div className="mt-4 flex items-stretch gap-2">
              <Button variant="outline" size="icon" className="h-auto shrink-0" onClick={() => setDay(addDays(selectedDay, -7))} aria-label={t("previousWeek")}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-0 flex-1"><BookingWeekStrip days={week.days} counts={counts} selectedDay={selectedDay} today={today} loading={calendarLoading && !calendarError} onSelect={(value) => { setDay(value); setPendingStart(null); setCursor(null) }} weekdayLabel={(value) => formatDate(`${value}T12:00:00Z`, locale, { weekday: "short", timeZone: "UTC" })} dayNumber={(value) => String(Number(value.slice(-2)))} /></div>
              <Button variant="outline" size="icon" className="h-auto shrink-0" onClick={() => setDay(addDays(selectedDay, 7))} aria-label={t("nextWeek")}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            {context?.canCoordinate && hostChips.length > 1 ? <div className="mt-3.5"><BookingHostChips hosts={hostChips} anyMeta={t("dayCount", { count: loaded.filter((row) => row.status !== "cancelled").length })} selected={host} onSelect={(value) => { setHost(value); setPendingStart(null); setCursor(null) }} /></div> : null}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
              <BookingDayLegend statuses={dayStatuses} statusLabel={state} />
              {slotsQuery.isError ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("bookingLoadError")}</p> : null}
            </div>
            {loading && !items.length ? <p role="status" className="py-12 text-center text-muted-foreground">{t("workspaceLoading")}</p>
              : !dayMeetings.length && !freeWindows.length ? <div className="py-12 text-center">
                <CalendarCheck aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                <h3 className="font-medium">{t("dayEmpty")}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t(query || host || page || status !== "all" ? "meetingsEmptyFilters" : canBook ? "dayEmptyHint" : "meetingsEmptyHint")}</p>
              </div>
              : <div className="mt-2"><BookingDayTimeline
                meetings={dayMeetings}
                windows={freeWindows}
                busy={busySpans}
                nowMinutes={selectedDay === today ? minutesFrom(dayStartMs, instant) : null}
                selectedId={selectedId}
                pendingStart={pendingSpan?.start ?? null}
                pendingEnd={pendingSpan?.end ?? null}
                onSelect={openMeeting}
                onBook={canBook ? (startsAt) => startBooking(startsAt) : null}
                onBookAt={canBook ? (minutes) => startBooking(new Date(dayStartMs + minutes * 60_000).toISOString()) : null}
                time={railTime}
                statusLabel={state}
                duration={duration}
              /></div>}
          </CrmSection>
          <div>
            {creating ? <CrmSection>
              <div className="mb-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold">{t("createMeeting")}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t("notBookedYet")}</p>
                </div>
                <Button variant="ghost" size="sm" className="-mr-2 -mt-1 shrink-0" onClick={closePanel}>{t("cancel")}</Button>
              </div>
              {createPanel}
            </CrmSection>
              : selectedId ? <CrmSection>{detailPanel(closePanel, schedule)}</CrmSection> : <CrmSection className="py-10 text-center">
              <CalendarRange aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <h3 className="font-medium">{t("chooseMeeting")}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{t(canBook ? "chooseMeetingHint" : "chooseMeetingHintReadOnly")}</p>
            </CrmSection>}
          </div>
        </div>}
      </section> : <>
        {view === "calendar" ? <section className="space-y-3" aria-label={t("viewCalendar")} aria-busy={calendarLoading}>
          <div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label={t("previousMonth")}><ChevronLeft className="h-4 w-4" /></Button><Label htmlFor="meeting-month" className="sr-only">{t("viewCalendar")}</Label><Input id="meeting-month" type="month" lang={locale} className="w-auto" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setDay(null) } }} /><Button variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label={t("nextMonth")}><ChevronRight className="h-4 w-4" /></Button></div>
          {calendarError ? <p role="alert" className="text-sm text-destructive">{t("errLoad")}</p> : <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">{grid.days.slice(0, 7).map((value) => <span key={value} className="border-b bg-muted/30 py-2 text-center text-xs font-medium">{formatDate(`${value}T12:00:00Z`, locale, { weekday: "short", timeZone: "UTC" })}</span>)}{grid.days.map((value) => <button type="button" key={value} onClick={() => setDay(value)} aria-pressed={selectedDay === value} className={`min-h-16 border-b p-2 text-left transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-20 ${selectedDay === value ? "bg-primary/10" : ""} ${value.slice(0, 7) !== month ? "text-muted-foreground" : ""}`}><span className={`text-sm ${value === today ? "font-bold text-primary" : ""}`}>{Number(value.slice(-2))}</span>{/* An empty day is empty. A dash in every free cell made a month of
    nothing look like a month of data, and hid the days that had some. */}
<span className="mt-1 block text-xs sm:text-sm">{calendarLoading ? <span className="text-muted-foreground">…</span> : counts[value] ? <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{t("dayCount", { count: counts[value] })}</span> : null}</span><span className="sr-only">{formatDate(`${value}T12:00:00Z`, locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</span></button>)}</div>}
          <h2 className="text-lg font-semibold">{date(atMidnight(selectedDay))}</h2>
        </section> : null}
        {error ? <CrmSection role="alert" tone="destructive"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }}>{t("retry")}</Button></CrmSection> : loading && !items.length ? <p role="status" className="py-12 text-center text-muted-foreground">{t("workspaceLoading")}</p> : !items.length ? <CrmSection className="px-5 py-12 text-center"><CalendarCheck className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h2 className="font-medium">{t("meetingsEmpty")}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t(query || host || page || status !== "all" ? "meetingsEmptyFilters" : "meetingsEmptyHint")}</p>{context?.canConfigure ? <Button className="mt-4" variant="outline" asChild><Link href={BOOKING_SECTION_PATHS.pages}>{t("workspacePages")}</Link></Button> : null}</CrmSection> : <section aria-label={t("workspaceMeetings")} aria-busy={loading} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
          {items.map((item) => <button type="button" key={item.id} className="grid min-h-24 w-full gap-2 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[10rem_minmax(0,1fr)_minmax(7rem,auto)] sm:items-center" onClick={() => navigate({ booking: item.id })}>
            <span><span className="block text-sm font-medium">{date(item.startsAt)}</span><span className="text-sm tabular-nums text-muted-foreground">{time(item.startsAt)}–{time(item.endsAt)}</span></span>
            <span className="min-w-0"><span className="block break-words font-medium">{item.name}</span><span className="block break-words text-sm text-muted-foreground">{item.bookingPage.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.hostName ?? t("hostUnknown")} · {t(`location_${["office", "phone", "online"].includes(item.bookingPage.locationType) ? item.bookingPage.locationType : "office"}`)}</span></span>
            <span className="flex flex-wrap items-center gap-2 text-sm sm:justify-end"><BookingStatus status={item.status}>{state(item.status)}</BookingStatus>{item.status === "confirmed" && item.endsAt < instant ? <span className="block w-full text-xs text-amber-700 sm:text-right dark:text-amber-300">{t("outcomeNeeded")}</span> : null}</span>
          </button>)}
        </section>}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={!cursor || loading} onClick={() => setCursor(null)}>{t("firstPage")}</Button><p className="text-xs text-muted-foreground">{t("shownCount", { count: items.length })}</p><Button variant="outline" disabled={!nextCursor || loading} onClick={() => setCursor(nextCursor)}>{t("nextPage")}</Button></div>
      </>}
    </>}
    <Sheet open={view !== "day" && (creating || Boolean(selectedId))} onOpenChange={(open) => { if (!open) closePanel() }}><SheetContent closeLabel={t("close")} surface={creating ? undefined : "canvas"} className="w-full overflow-y-auto sm:max-w-xl [&_button]:min-h-11 [&_button]:min-w-11 [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_select]:min-h-11">
      <SheetHeader className={creating ? undefined : "-mx-6 -mt-6 border-b border-border bg-card p-6 pr-12 text-left"}><SheetTitle className="break-words">{creating ? t("createMeeting") : detail?.name ?? t("workspaceDetails")}</SheetTitle><SheetDescription className="break-words">{creating ? t("createMeetingHint") : detail?.bookingPage.title ?? t("workspaceDetailsHint")}</SheetDescription></SheetHeader>
      <div className="mt-5">{creating ? createPanel : detailPanel()}</div>
    </SheetContent></Sheet>
    {/* The meeting is booked: what went out to the client and what else is on
        that host's day, before the screen goes back to the rail. */}
    <Sheet open={Boolean(justBooked) && detail?.id === justBooked} onOpenChange={(open) => { if (!open) setJustBooked(null) }}><SheetContent closeLabel={t("close")} className="w-full overflow-y-auto sm:max-w-xl [&_button]:min-h-11 [&_button]:min-w-11 [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_select]:min-h-11">
      <SheetHeader className="text-left">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <SheetTitle className="break-words text-xl">{t("bookedTitle")}</SheetTitle>
            <SheetDescription className="break-words">{detail ? t("bookedHint", { name: detail.name }) : ""}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="mt-5">{detailPanel(undefined, schedule)}</div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { setJustBooked(null); startBooking(null) }}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{t("bookAnother")}</Button>
        <Button className="flex-1" onClick={() => setJustBooked(null)}><CheckCircle2 aria-hidden="true" className="h-4 w-4" />{t("bookedDone")}</Button>
      </div>
    </SheetContent></Sheet>
  </main>
}
