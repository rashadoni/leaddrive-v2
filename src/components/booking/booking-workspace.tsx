"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { CalendarDays, CalendarCheck, ChevronLeft, ChevronRight, List, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BookingPagesPanel } from "./booking-pages-panel"
import { BookingCoordinatorsPanel } from "./booking-coordinators-panel"
import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { formatDate, formatTime } from "@/lib/format-date"

export interface WorkspaceBooking {
  id: string
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
  bookingPage: { title: string; locationType: string; locationText: string | null }
  leadId?: string | null
  taskId?: string | null
}
interface Context {
  timezone: string
  userId: string
  canConfigure: boolean
  canCoordinate: boolean
  hosts: { id: string; name: string; isActive: boolean }[]
  pages: { id: string; title: string }[]
}
interface BookingList extends Context { items: WorkspaceBooking[]; nextCursor: string | null }
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

export function BookingWorkspace() {
  const t = useTranslations("booking")
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const tab = params.get("tab") === "pages" ? "pages" : params.get("tab") === "team" ? "team" : "meetings"
  const selectedId = params.get("booking")
  const { data: session } = useSession()
  const identity = `${session?.user?.organizationId ?? ""}:${session?.user?.id ?? ""}`
  const contextQuery = useQuery({ queryKey: ["booking-context", identity], queryFn: ({ signal }) => readBookingData<Context>("/api/v1/bookings/context", signal), retry: false })
  const context = contextQuery.data
  const [pagination, setPagination] = useState<{ key: string; cursor: string | null }>({ key: "", cursor: null })
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState("list")
  const [period, setPeriod] = useState("upcoming")
  const [status, setStatus] = useState("all")
  const [host, setHost] = useState("")
  const [page, setPage] = useState("")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [instant] = useState(() => new Date().toISOString())
  const timezone = context?.timezone ?? "Asia/Baku"
  const today = dateInputValueInTimezone(instant, timezone)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [day, setDay] = useState<string | null>(null)
  const contextReady = Boolean(context)
  const selectedDay = day ?? `${month}-01`
  const grid = useMemo(() => calendarWindow(month), [month])
  const atMidnight = useCallback((value: string) => localDateTimeToUtc(`${value}T00:00`, timezone).toISOString(), [timezone])

  const navigate = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    router.replace(`/meetings${next.size ? `?${next}` : ""}`, { scroll: false })
  }, [params, router])

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])

  const filters = useMemo(() => {
    const result = new URLSearchParams({ status, limit: "50" })
    if (host) result.set("host", host)
    if (page) result.set("page", page)
    if (query) result.set("search", query)
    return result
  }, [status, host, page, query])

  const paginationKey = [period, status, host, page, query, selectedDay, view, timezone].join("|")
  const cursor = pagination.key === paginationKey ? pagination.cursor : null
  const setCursor = (next: string | null) => setPagination({ key: paginationKey, cursor: next })
  const request = new URLSearchParams(filters)
  if (view === "calendar") {
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
  const calendarRequest = new URLSearchParams(filters)
  calendarRequest.set("from", atMidnight(grid.start)); calendarRequest.set("to", atMidnight(grid.end))
  const calendarQuery = useQuery({
    queryKey: ["booking-calendar", identity, calendarRequest.toString(), revision],
    queryFn: ({ signal }) => readBookingData<{ days: { day: string; count: number }[] }>(`/api/v1/bookings/calendar?${calendarRequest}`, signal),
    enabled: contextReady && tab === "meetings" && view === "calendar", retry: false,
  })
  const detailQuery = useQuery({
    queryKey: ["booking-detail", identity, selectedId, revision],
    queryFn: ({ signal }) => readBookingData<WorkspaceBooking>(`/api/v1/bookings/${encodeURIComponent(selectedId!)}`, signal),
    enabled: Boolean(selectedId) && contextReady, retry: false,
  })
  const items = listQuery.isError ? [] : listQuery.data?.items ?? []
  const nextCursor = listQuery.data?.nextCursor ?? null
  const loading = contextQuery.isPending || (tab === "meetings" && listQuery.isFetching)
  const failure = contextQuery.error ?? listQuery.error
  const error = failure ? t(failure.message === "access" ? "workspaceForbidden" : "errLoad") : ""
  const calendarLoading = calendarQuery.isFetching
  const calendarError = calendarQuery.isError
  const counts: Record<string, number> = Object.fromEntries((calendarQuery.data?.days ?? []).map((row) => [row.day, row.count]))
  const detail = detailQuery.isError ? null : detailQuery.data
  const detailError = detailQuery.isError ? t("meetingUnavailable") : ""

  const date = (value: string) => formatDate(value, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })
  const time = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })
  const state = (value: string) => t(STATUS_KEYS[value] ?? "meetingUnknownStatus")
  function moveMonth(amount: number) {
    const value = new Date(`${month}-01T12:00:00Z`)
    value.setUTCMonth(value.getUTCMonth() + amount)
    setMonth(value.toISOString().slice(0, 7)); setDay(null); setCursor(null)
  }

  return <main className="space-y-5" data-testid="booking-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("workspaceTitle")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("workspaceHint")}</p></div>
      <Button variant="outline" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label={t("refresh")}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}</Button>
    </header>
    <nav className="flex flex-wrap gap-1 border-b" aria-label={t("workspaceSections")}>
      {(["meetings", ...(context?.canConfigure ? ["pages", "team"] : [])] as string[]).map((item) => <Button key={item} variant={tab === item ? "secondary" : "ghost"} className="min-h-11 rounded-b-none" aria-current={tab === item ? "page" : undefined} onClick={() => navigate({ tab: item === "meetings" ? null : item, booking: null })}>{t(item === "meetings" ? "workspaceMeetings" : item === "pages" ? "workspacePages" : "workspaceTeam")}</Button>)}
    </nav>
    {tab === "pages" ? context?.canConfigure ? <BookingPagesPanel /> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : tab === "team" ? context?.canConfigure ? <BookingCoordinatorsPanel /> : <p role="status">{loading ? t("workspaceLoading") : t("workspaceForbidden")}</p> : <>
      <section className="flex flex-wrap items-end gap-3" aria-label={t("workspaceFilters")}>
        <div className="min-w-44 flex-1 space-y-1"><Label htmlFor="meeting-search">{t("workspaceSearch")}</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="meeting-search" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" placeholder={t("workspaceSearchHint")} /></div></div>
        {view === "list" ? <div className="space-y-1"><Label htmlFor="meeting-period">{t("workspacePeriod")}</Label><select id="meeting-period" className={`${SELECT} block`} value={period} onChange={(event) => { setPeriod(event.target.value); setDay(null) }}>{["upcoming", "today", "week", "all"].map((value) => <option key={value} value={value}>{t(`period_${value}`)}</option>)}</select></div> : null}
        <div className="space-y-1"><Label htmlFor="meeting-state">{t("workspaceStatus")}</Label><select id="meeting-state" className={`${SELECT} block`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t("allStatuses")}</option>{Object.keys(STATUS_KEYS).map((value) => <option key={value} value={value}>{state(value)}</option>)}</select></div>
        {context?.canCoordinate ? <div className="space-y-1"><Label htmlFor="meeting-host">{t("colHosts")}</Label><select id="meeting-host" className={`${SELECT} block max-w-60`} value={host} onChange={(event) => setHost(event.target.value)}><option value="">{t("availableTeam")}</option><option value={context.userId}>{t("myMeetings")}</option>{context.hosts.filter((item) => item.id !== context.userId).map((item) => <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ` · ${t("hostInactive")}` : ""}</option>)}</select></div> : <p className="pb-3 text-sm text-muted-foreground">{t("myMeetings")}</p>}
        {context && context.pages.length > 1 ? <div className="space-y-1"><Label htmlFor="meeting-page">{t("colPage")}</Label><select id="meeting-page" className={`${SELECT} block max-w-60`} value={page} onChange={(event) => setPage(event.target.value)}><option value="">{t("allPages")}</option>{context.pages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></div> : null}
        <div className="flex gap-1" role="group" aria-label={t("workspaceView")}><Button variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => { setView("list"); setDay(null) }}><List className="h-4 w-4" />{t("viewList")}</Button><Button variant={view === "calendar" ? "secondary" : "ghost"} aria-pressed={view === "calendar"} onClick={() => { setView("calendar"); setDay(today) }}><CalendarDays className="h-4 w-4" />{t("viewCalendar")}</Button></div>
      </section>
      <p className="text-xs text-muted-foreground">{t("timezoneNote", { zone: timezone })}</p>
      {view === "calendar" ? <section className="space-y-3" aria-label={t("viewCalendar")} aria-busy={calendarLoading}>
        <div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label={t("previousMonth")}><ChevronLeft className="h-4 w-4" /></Button><Label htmlFor="meeting-month" className="sr-only">{t("viewCalendar")}</Label><Input id="meeting-month" type="month" className="w-auto" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setDay(null) } }} /><Button variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label={t("nextMonth")}><ChevronRight className="h-4 w-4" /></Button></div>
        {calendarError ? <p role="alert" className="text-sm text-destructive">{t("errLoad")}</p> : <div className="grid grid-cols-7 overflow-hidden rounded-xl border">{grid.days.slice(0, 7).map((value) => <span key={value} className="border-b bg-muted/30 py-2 text-center text-xs font-medium">{formatDate(`${value}T12:00:00Z`, locale, { weekday: "short", timeZone: "UTC" })}</span>)}{grid.days.map((value) => <button type="button" key={value} onClick={() => setDay(value)} aria-pressed={selectedDay === value} className={`min-h-16 border-b p-2 text-left transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-20 ${selectedDay === value ? "bg-primary/10" : ""} ${value.slice(0, 7) !== month ? "text-muted-foreground" : ""}`}><span className={`text-sm ${value === today ? "font-bold text-primary" : ""}`}>{Number(value.slice(-2))}</span><span className="mt-1 block text-xs sm:text-sm">{calendarLoading ? "…" : counts[value] ? t("dayCount", { count: counts[value] }) : "—"}</span><span className="sr-only">{date(`${value}T12:00:00Z`)}</span></button>)}</div>}
        <h2 className="text-lg font-semibold">{date(atMidnight(selectedDay))}</h2>
      </section> : null}
      {error ? <div role="alert" className="rounded-xl border p-5"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button></div> : loading && !items.length ? <p role="status" className="py-12 text-center text-muted-foreground">{t("workspaceLoading")}</p> : !items.length ? <div className="rounded-xl border px-5 py-12 text-center"><CalendarCheck className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h2 className="font-medium">{t("meetingsEmpty")}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t(query || host || page || status !== "all" ? "meetingsEmptyFilters" : "meetingsEmptyHint")}</p>{context?.canConfigure ? <Button className="mt-4" variant="outline" onClick={() => navigate({ tab: "pages" })}>{t("workspacePages")}</Button> : null}</div> : <section aria-label={t("workspaceMeetings")} aria-busy={loading} className="divide-y rounded-xl border">
        {items.map((item) => <button type="button" key={item.id} className="grid min-h-24 w-full gap-2 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[10rem_minmax(0,1fr)_minmax(7rem,auto)] sm:items-center" onClick={() => navigate({ booking: item.id })}>
          <span><span className="block text-sm font-medium">{date(item.startsAt)}</span><span className="text-sm tabular-nums text-muted-foreground">{time(item.startsAt)}–{time(item.endsAt)}</span></span>
          <span className="min-w-0"><span className="block break-words font-medium">{item.name}</span><span className="block break-words text-sm text-muted-foreground">{item.bookingPage.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.hostName ?? t("hostUnknown")} · {t(`location_${["office", "phone", "online"].includes(item.bookingPage.locationType) ? item.bookingPage.locationType : "office"}`)}</span></span>
          <span className="text-sm sm:text-right">{state(item.status)}{item.status === "confirmed" && item.endsAt < instant ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{t("outcomeNeeded")}</span> : null}</span>
        </button>)}
      </section>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={!cursor || loading} onClick={() => setCursor(null)}>{t("firstPage")}</Button><p className="text-xs text-muted-foreground">{t("shownCount", { count: items.length })}</p><Button variant="outline" disabled={!nextCursor || loading} onClick={() => setCursor(nextCursor)}>{t("nextPage")}</Button></div>
    </>}
    <Sheet open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) navigate({ booking: null }) }}><SheetContent closeLabel={t("close")} className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader><SheetTitle>{detail?.name ?? t("workspaceDetails")}</SheetTitle><SheetDescription>{detail?.bookingPage.title ?? t("workspaceDetailsHint")}</SheetDescription></SheetHeader>
      {detailError ? <p role="alert" className="mt-5">{detailError}</p> : !detail ? <p role="status" className="mt-5">{t("workspaceLoading")}</p> : <div className="mt-6 space-y-6">
        <div className="space-y-1"><p className="text-lg font-semibold">{date(detail.startsAt)}</p><p className="text-lg tabular-nums">{time(detail.startsAt)}–{time(detail.endsAt)}</p><p className="text-sm text-muted-foreground">{timezone}</p><p className="pt-2 text-sm font-medium">{state(detail.status)}</p></div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm"><dt className="text-muted-foreground">{t("colHosts")}</dt><dd>{detail.hostName ?? t("hostUnknown")}</dd><dt className="text-muted-foreground">{t("phone")}</dt><dd className="break-all">{detail.phone}</dd>{detail.email ? <><dt className="text-muted-foreground">{t("email")}</dt><dd className="break-all">{detail.email}</dd></> : null}<dt className="text-muted-foreground">{t("fieldLocation")}</dt><dd className="whitespace-pre-wrap break-words">{detail.bookingPage.locationText || t(`location_${detail.bookingPage.locationType}`)}</dd></dl>
        {detail.note ? <section><h3 className="text-sm font-medium">{t("customerNote")}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{detail.note}</p></section> : null}
        <section className="space-y-2 border-t pt-4"><h3 className="text-sm font-medium">{t("workspaceHistory")}</h3><p className="text-sm">{t("bookingCreated")} · {date(detail.createdAt)} {time(detail.createdAt)}</p>{detail.cancelledAt ? <p className="text-sm">{t("meetingCancelled")} · {date(detail.cancelledAt)} {time(detail.cancelledAt)}</p> : null}<p className="text-xs text-muted-foreground">{t("calendarLinkState", { state: t(detail.calendarLinked ? "calendarLinked" : "calendarNotLinked") })}</p></section>
        {detail.leadId || detail.taskId ? <div className="flex flex-wrap gap-2 border-t pt-4">{detail.leadId ? <Button variant="outline" size="sm" asChild><a href={`/leads/${encodeURIComponent(detail.leadId)}`}>{t("openLead")}</a></Button> : null}{detail.taskId ? <Button variant="ghost" size="sm" asChild><a href={`/tasks/${encodeURIComponent(detail.taskId)}`}>{t("openTask")}</a></Button> : null}</div> : null}
      </div>}
    </SheetContent></Sheet>
  </main>
}
