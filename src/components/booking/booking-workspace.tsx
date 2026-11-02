"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { CalendarCheck, CalendarDays, CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, List, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BookingPagesPanel } from "./booking-pages-panel"
import { BookingDayLegend, BookingDaySummary, BookingDayTimeline, BookingWeekStrip, mergeFreeWindows, minutesFrom, type TimelineMeeting } from "./booking-day-timeline"
import { BookingDetail } from "./booking-detail"
import { type BookingHistoryItem } from "./booking-history"
import { BookingCreatePanel } from "./booking-create-panel"
import { BookingCoordinatorsPanel } from "./booking-coordinators-panel"
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
  bookingPage: { title: string; locationType: string; locationText: string | null; timezone?: string | null }
  leadId?: string | null
  taskId?: string | null
}
interface Context {
  writableHostIds: string[] | null
  timezone: string
  userId: string
  canConfigure: boolean
  canCoordinate: boolean
  hosts: { id: string; name: string; isActive: boolean; canReceiveBookings: boolean }[]
  pages: { id: string; title: string; hostIds: string[]; isActive: boolean }[]
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

export function BookingWorkspace() {
  const t = useTranslations("booking")
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const tab = params.get("tab") === "pages" ? "pages" : params.get("tab") === "team" ? "team" : "meetings"
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

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])

  const filters = new URLSearchParams({ status, limit: "50" })
  if (host) filters.set("host", host)
  if (page) filters.set("page", page)
  if (query) filters.set("search", query)

  const paginationKey = [period, status, host, page, query, selectedDay, view, timezone].join("|")
  const cursor = pagination.key === paginationKey ? pagination.cursor : null
  const setCursor = (next: string | null) => setPagination({ key: paginationKey, cursor: next })
  const request = new URLSearchParams(filters)
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
  const slotsRequest = freePage ? new URLSearchParams({ pageId: freePage.id, day: selectedDay, ...(host ? { hostId: host } : {}) }).toString() : ""
  const slotsQuery = useQuery({
    queryKey: ["booking-day-slots", identity, slotsRequest, revision],
    queryFn: ({ signal }) => readBookingData<{ page: { durationMinutes: number }; days: DaySlots[] }>(`/api/v1/bookings/availability?${slotsRequest}`, signal),
    enabled: contextReady && tab === "meetings" && view === "day" && Boolean(slotsRequest), retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false,
  })
  const items = listQuery.isError ? [] : listQuery.data?.items ?? []
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
  }))
  const freeWindows = mergeFreeWindows(slotsQuery.data?.days.find((item) => item.date === selectedDay)?.slots ?? [], dayStartMs)
  const slotMinutes = slotsQuery.data?.page.durationMinutes ?? 30
  const pendingMinutes = pendingStart ? minutesFrom(dayStartMs, pendingStart) : null
  const pendingOnDay = pendingMinutes !== null && pendingMinutes >= 0 && pendingMinutes < 24 * 60 ? pendingMinutes : null
  const canBook = Boolean(freePage)
  const dayStatuses = Object.keys(STATUS_KEYS).filter((value) => dayMeetings.some((meeting) => meeting.status === value))

  const createPanel = context ? <BookingCreatePanel
    pages={bookablePages}
    hosts={context.hosts.filter((item) => item.isActive && item.canReceiveBookings)}
    timezone={timezone}
    initial={{ pageId: freePage?.id, hostId: host || undefined, day: view === "day" ? selectedDay : undefined, startsAt: pendingStart ?? undefined }}
    onStartChange={view === "day" ? setPendingStart : undefined}
    onSaved={(id) => { setCreating(false); setPendingStart(null); navigate({ booking: id }); setRevision((value) => value + 1) }}
  /> : null
  const detailPanel = (onClose?: () => void) => detailError
    ? <CrmSection role="alert" tone="destructive">{detailError}</CrmSection>
    : !detail ? <p role="status" className="text-muted-foreground">{t("workspaceLoading")}</p>
      : context ? <BookingDetail booking={detail} context={context} identity={identity} onSaved={() => setRevision((value) => value + 1)} onClose={onClose} /> : null

  return <main className="space-y-5 [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11" data-testid="booking-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("workspaceTitle")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("workspaceHint")}</p></div>
      <div className="flex flex-wrap gap-2">{bookablePages.length && !creating ? <Button onClick={() => { navigate({ booking: null }); setPendingStart(null); setCreating(true) }}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{t("createMeeting")}</Button> : null}<Button variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }} disabled={loading} aria-label={t("refresh")}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}</Button></div>
    </header>
    <nav data-crm-tabs="" className="flex flex-wrap gap-1 border-b" aria-label={t("workspaceSections")}>
      {(["meetings", ...(context?.canConfigure ? ["pages", "team"] : [])] as string[]).map((item) => <Button key={item} data-crm-tab="" data-state={tab === item ? "active" : "inactive"} variant={tab === item ? "secondary" : "ghost"} className="min-h-11 rounded-b-none" aria-current={tab === item ? "page" : undefined} onClick={() => navigate({ tab: item === "meetings" ? null : item, booking: null })}>{t(item === "meetings" ? "workspaceMeetings" : item === "pages" ? "workspacePages" : "workspaceTeam")}</Button>)}
    </nav>
    {tab === "pages" ? context?.canConfigure ? <BookingPagesPanel /> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : tab === "team" ? context?.canConfigure ? <BookingCoordinatorsPanel /> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : <>
      <section className="flex flex-wrap items-end gap-3" aria-label={t("workspaceFilters")}>
        <div className="min-w-44 flex-1 space-y-1"><Label htmlFor="meeting-search">{t("workspaceSearch")}</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="meeting-search" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" placeholder={t("workspaceSearchHint")} /></div></div>
        {view === "list" ? <div className="space-y-1"><Label htmlFor="meeting-period">{t("workspacePeriod")}</Label><select id="meeting-period" className={`${SELECT} block`} value={period} onChange={(event) => { setPeriod(event.target.value); setDay(null) }}>{["upcoming", "today", "week", "all"].map((value) => <option key={value} value={value}>{t(`period_${value}`)}</option>)}</select></div> : null}
        <div className="space-y-1"><Label htmlFor="meeting-state">{t("workspaceStatus")}</Label><select id="meeting-state" className={`${SELECT} block`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t("allStatuses")}</option>{Object.keys(STATUS_KEYS).map((value) => <option key={value} value={value}>{state(value)}</option>)}</select></div>
        {context?.canCoordinate ? <div className="space-y-1"><Label htmlFor="meeting-host">{t("colHosts")}</Label><select id="meeting-host" className={`${SELECT} block max-w-60`} value={host} onChange={(event) => setHost(event.target.value)}><option value="">{t("availableTeam")}</option><option value={context.userId}>{t("myMeetings")}</option>{context.hosts.filter((item) => item.id !== context.userId).map((item) => <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ` · ${t("hostInactive")}` : ""}</option>)}</select></div> : <p className="pb-3 text-sm text-muted-foreground">{t("myMeetings")}</p>}
        {context && context.pages.length > 1 ? <div className="space-y-1"><Label htmlFor="meeting-page">{t("colPage")}</Label><select id="meeting-page" className={`${SELECT} block max-w-60`} value={page} onChange={(event) => setPage(event.target.value)}><option value="">{t("allPages")}</option>{context.pages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></div> : null}
        <div data-crm-tabs="" className="flex gap-1 border-b" role="group" aria-label={t("workspaceView")}>
          {([["day", t("viewDay"), CalendarRange], ["list", t("viewList"), List], ["calendar", t("viewCalendar"), CalendarDays]] as const).map(([value, label, Icon]) => <Button key={value} data-crm-tab="" data-state={view === value ? "active" : "inactive"} variant={view === value ? "secondary" : "ghost"} aria-pressed={view === value} onClick={() => { setView(value); setPendingStart(null); setDay(value === "list" ? null : today) }}><Icon className="h-4 w-4" />{label}</Button>)}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">{t("timezoneNote", { zone: timezone })}</p>
      {view === "day" ? <section className="space-y-4" aria-label={t("viewDay")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => setDay(addDays(selectedDay, -7))} aria-label={t("previousWeek")}><ChevronLeft className="h-4 w-4" /></Button>
          {/* On a phone the arrows and «today» keep one row and the week takes the next; from sm up it is one line with the week between the arrows. */}
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"><BookingWeekStrip days={week.days} counts={counts} selectedDay={selectedDay} today={today} loading={calendarLoading && !calendarError} onSelect={(value) => { setDay(value); setPendingStart(null); setCursor(null) }} weekdayLabel={(value) => formatDate(`${value}T12:00:00Z`, locale, { weekday: "short", timeZone: "UTC" })} dayNumber={(value) => String(Number(value.slice(-2)))} /></div>
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => setDay(addDays(selectedDay, 7))} aria-label={t("nextWeek")}><ChevronRight className="h-4 w-4" /></Button>
          {selectedDay === today ? null : <Button variant="outline" onClick={() => { setDay(today); setPendingStart(null) }}>{t("jumpToday")}</Button>}
        </div>
        {error ? <CrmSection role="alert" tone="destructive"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }}>{t("retry")}</Button></CrmSection> : <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <CrmSection aria-busy={loading}>
            <div className="mb-4 space-y-2 border-b border-border pb-4">
              <h2 className="text-lg font-semibold first-letter:uppercase">{formatDate(atMidnight(selectedDay), locale, { weekday: "long", day: "numeric", month: "long", timeZone: timezone })}</h2>
              <BookingDaySummary meetings={dayMeetings} windows={freeWindows} duration={duration} busyHint={t("busyHint")} windowsHint={freePage ? t("windowsHint", { page: freePage.title }) : ""} />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <BookingDayLegend statuses={dayStatuses} statusLabel={state} />
                {slotsQuery.isError ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("bookingLoadError")}</p> : freePage && bookablePages.length > 1 ? <p className="text-xs text-muted-foreground">{t("freeWindowFor", { page: freePage.title })}</p> : null}
              </div>
            </div>
            {loading && !items.length ? <p role="status" className="py-12 text-center text-muted-foreground">{t("workspaceLoading")}</p>
              : !dayMeetings.length && !freeWindows.length ? <div className="py-12 text-center">
                <CalendarCheck aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                <h3 className="font-medium">{t("dayEmpty")}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t(query || host || page || status !== "all" ? "meetingsEmptyFilters" : canBook ? "dayEmptyHint" : "meetingsEmptyHint")}</p>
              </div>
              : <BookingDayTimeline
                meetings={dayMeetings}
                windows={freeWindows}
                nowMinutes={selectedDay === today ? minutesFrom(dayStartMs, instant) : null}
                selectedId={selectedId}
                pendingStart={pendingOnDay}
                pendingEnd={pendingOnDay === null ? null : pendingOnDay + slotMinutes}
                onSelect={openMeeting}
                onBook={canBook ? (startsAt) => { setPendingStart(startsAt); setDay(selectedDay); navigate({ booking: null }); setCreating(true) } : null}
                time={railTime}
                statusLabel={state}
                duration={duration}
              />}
          </CrmSection>
          <div className="space-y-4">
            {creating ? <CrmSection title={<span className="flex flex-1 items-center justify-between gap-2">{t("createMeeting")}<Button variant="ghost" size="sm" className="-mr-2 -my-1 font-normal" onClick={closePanel}>{t("cancel")}</Button></span>} icon={<CalendarPlus aria-hidden="true" className="h-4 w-4" />}>{createPanel}</CrmSection>
              : selectedId ? detailPanel(closePanel) : <CrmSection className="py-10 text-center">
              <CalendarRange aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <h3 className="font-medium">{t("chooseMeeting")}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{t(canBook ? "chooseMeetingHint" : "chooseMeetingHintReadOnly")}</p>
            </CrmSection>}
          </div>
        </div>}
      </section> : <>
        {view === "calendar" ? <section className="space-y-3" aria-label={t("viewCalendar")} aria-busy={calendarLoading}>
          <div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label={t("previousMonth")}><ChevronLeft className="h-4 w-4" /></Button><Label htmlFor="meeting-month" className="sr-only">{t("viewCalendar")}</Label><Input id="meeting-month" type="month" lang={locale} className="w-auto" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setDay(null) } }} /><Button variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label={t("nextMonth")}><ChevronRight className="h-4 w-4" /></Button></div>
          {calendarError ? <p role="alert" className="text-sm text-destructive">{t("errLoad")}</p> : <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">{grid.days.slice(0, 7).map((value) => <span key={value} className="border-b bg-muted/30 py-2 text-center text-xs font-medium">{formatDate(`${value}T12:00:00Z`, locale, { weekday: "short", timeZone: "UTC" })}</span>)}{grid.days.map((value) => <button type="button" key={value} onClick={() => setDay(value)} aria-pressed={selectedDay === value} className={`min-h-16 border-b p-2 text-left transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-20 ${selectedDay === value ? "bg-primary/10" : ""} ${value.slice(0, 7) !== month ? "text-muted-foreground" : ""}`}><span className={`text-sm ${value === today ? "font-bold text-primary" : ""}`}>{Number(value.slice(-2))}</span><span className="mt-1 block text-xs sm:text-sm">{calendarLoading ? "…" : counts[value] ? t("dayCount", { count: counts[value] }) : "—"}</span><span className="sr-only">{formatDate(`${value}T12:00:00Z`, locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</span></button>)}</div>}
          <h2 className="text-lg font-semibold">{date(atMidnight(selectedDay))}</h2>
        </section> : null}
        {error ? <CrmSection role="alert" tone="destructive"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => { void contextQuery.refetch(); setRevision((value) => value + 1) }}>{t("retry")}</Button></CrmSection> : loading && !items.length ? <p role="status" className="py-12 text-center text-muted-foreground">{t("workspaceLoading")}</p> : !items.length ? <CrmSection className="px-5 py-12 text-center"><CalendarCheck className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h2 className="font-medium">{t("meetingsEmpty")}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t(query || host || page || status !== "all" ? "meetingsEmptyFilters" : "meetingsEmptyHint")}</p>{context?.canConfigure ? <Button className="mt-4" variant="outline" onClick={() => navigate({ tab: "pages" })}>{t("workspacePages")}</Button> : null}</CrmSection> : <section aria-label={t("workspaceMeetings")} aria-busy={loading} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
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
  </main>
}
