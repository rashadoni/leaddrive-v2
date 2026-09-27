"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RotateCcw,
  Ticket,
  Users,
  Video,
} from "lucide-react"

import { HelpButton } from "@/components/help/help-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatDate as formatDateLocale } from "@/lib/format-date"
import {
  EMPTY_CALENDAR_SOURCES,
  calendarDateParam,
  failedCalendarSources,
  getWeekDates,
  isOutsideBusinessHours,
  isSameCalendarDay,
  itemsForCalendarDay,
  nextCalendarItem,
  type CalendarItem,
  type CalendarSourceState,
} from "@/lib/support-calendar/presentation"

const DAY_KEYS = ["dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat", "daySun"] as const
const PAGE_SIZE = 20

const TYPE_CONFIG: Record<string, { icon: LucideIcon; labelKey: string }> = {
  ticket: { icon: Ticket, labelKey: "typeTicket" },
  task: { icon: CheckSquare, labelKey: "typeTask" },
  event: { icon: CalendarDays, labelKey: "typeEvent" },
  activity_call: { icon: Phone, labelKey: "typeCall" },
  activity_email: { icon: Mail, labelKey: "typeEmail" },
  activity_meeting: { icon: Users, labelKey: "typeMeeting" },
  activity_note: { icon: FileText, labelKey: "typeNote" },
  activity_task: { icon: CheckSquare, labelKey: "typeTaskActivity" },
  activity_message: { icon: MessageSquare, labelKey: "typeMessage" },
}

function itemConfig(type: string) {
  return TYPE_CONFIG[type] ?? { icon: Calendar, labelKey: "typeOther" }
}

function CalendarItemButton({ item, onOpen, compact = false }: { item: CalendarItem; onOpen: (item: CalendarItem, trigger: HTMLButtonElement) => void; compact?: boolean }) {
  const t = useTranslations("supportCalendar")
  const locale = useLocale()
  const config = itemConfig(item.type)
  const Icon = config.icon
  const title = item.title || t(config.labelKey)
  const time = item.allDay ? t("allDay") : new Date(item.date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  return (
    <button type="button" className={`w-full rounded-lg border text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${compact ? "min-h-11 p-2" : "min-h-14 p-3"}`} onClick={(event) => onOpen(item, event.currentTarget)} aria-label={t("openItemNamed", { title })} data-testid="support-calendar-item" data-item-id={`${item.type}-${item.id}`} data-outside-hours={isOutsideBusinessHours(item) ? "true" : "false"}>
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{time}</span><span>{t(config.labelKey)}</span>{isOutsideBusinessHours(item) && <span>{t("outsideHours")}</span>}</span>
        </span>
        {item.priority && <Badge variant="outline" className="shrink-0">{t.has(item.priority) ? t(item.priority) : t("unknownPriority")}</Badge>}
      </span>
    </button>
  )
}

function ItemDetailSheet({ item, onOpenChange, onNavigate }: { item: CalendarItem | null; onOpenChange: (open: boolean) => void; onNavigate: (url: string) => void }) {
  const t = useTranslations("supportCalendar")
  const locale = useLocale()
  if (!item) return null
  const config = itemConfig(item.type)
  const Icon = config.icon
  const title = item.title || t(config.labelKey)
  const start = new Date(item.date)
  const end = item.endDate ? new Date(item.endDate) : null
  const dateLabel = formatDateLocale(start, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const timeLabel = item.allDay ? t("allDay") : `${start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}${end ? ` — ${end.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}` : ""}`
  const knownStatus = item.status && t.has(`statusLabels.${item.status}`) ? t(`statusLabels.${item.status}`) : item.status ? t("unknownStatus") : null
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!h-[100dvh] !w-full !max-w-none overflow-y-auto sm:!w-[28rem] sm:!max-w-[28rem]" closeLabel={t("closeDetails")} data-testid="support-calendar-detail" data-item-id={`${item.type}-${item.id}`}>
        <SheetHeader className="pr-10"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-muted-foreground" /><SheetTitle>{title}</SheetTitle></div><SheetDescription>{t(config.labelKey)}</SheetDescription></SheetHeader>
        <dl className="mt-6 divide-y rounded-xl border text-sm">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="text-muted-foreground">{t("date")}</dt><dd>{dateLabel}</dd></div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="text-muted-foreground">{t("time")}</dt><dd>{timeLabel}{isOutsideBusinessHours(item) && <span className="mt-1 block text-xs text-muted-foreground">{t("outsideHoursDetail")}</span>}</dd></div>
          {knownStatus && <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="text-muted-foreground">{t("status")}</dt><dd>{knownStatus}</dd></div>}
          {item.priority && <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="text-muted-foreground">{t("priority")}</dt><dd>{t.has(item.priority) ? t(item.priority) : t("unknownPriority")}</dd></div>}
          {item.location && <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{t("location")}</dt><dd>{item.location}</dd></div>}
          {item.isOnline && <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 p-3"><dt className="flex items-center gap-1 text-muted-foreground"><Video className="h-3.5 w-3.5" />{t("format")}</dt><dd>{t("online")}</dd></div>}
        </dl>
        {item.url && <Button className="mt-5 min-h-11 w-full" onClick={() => onNavigate(item.url!)}>{t("openRecord")}<ExternalLink /></Button>}
      </SheetContent>
    </Sheet>
  )
}

export default function AgentCalendarPage() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const t = useTranslations("supportCalendar")
  const locale = useLocale()
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [items, setItems] = useState<CalendarItem[]>([])
  const [counts, setCounts] = useState({ tickets: 0, tasks: 0, events: 0, activities: 0 })
  const [sources, setSources] = useState<CalendarSourceState>(EMPTY_CALENDAR_SOURCES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [errorRetryable, setErrorRetryable] = useState(true)
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null)
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [agendaLimit, setAgendaLimit] = useState(PAGE_SIZE)
  const [expandedDays, setExpandedDays] = useState<string[]>([])

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])
  const weekLabel = `${formatDateLocale(weekDates[0], locale, { day: "numeric", month: "short" })} — ${formatDateLocale(weekDates[6], locale, { day: "numeric", month: "short", year: "numeric" })}`

  const fetchData = useCallback(async () => {
    if (!orgId) return
    let retryable = true
    setLoading(true)
    setError("")
    setErrorRetryable(true)
    try {
      const response = await fetch(`/api/v1/calendar/agent?from=${calendarDateParam(weekDates[0])}&to=${calendarDateParam(weekDates[6])}`)
      const payload = await response.json().catch(() => null)
      if (payload?.data?.sources) setSources(payload.data.sources)
      if (!response.ok || !payload?.success || !Array.isArray(payload?.data?.items)) {
        retryable = response.status !== 403
        throw new Error(response.status === 403 ? t("permissionDenied") : t("loadFailed"))
      }
      setItems(payload.data.items)
      setCounts(payload.data.counts ?? { tickets: 0, tasks: 0, events: 0, activities: 0 })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("loadFailed"))
      setErrorRetryable(retryable)
    } finally {
      setLoading(false)
    }
  }, [orgId, t, weekDates])

  useEffect(() => { void fetchData() }, [fetchData])

  const changeWeek = (offset: number) => {
    const next = new Date(currentDate)
    next.setDate(next.getDate() + offset * 7)
    setCurrentDate(next)
    setSelectedDate(getWeekDates(next)[0])
    setAgendaLimit(PAGE_SIZE)
    setExpandedDays([])
  }
  const goToday = () => {
    const now = new Date()
    setCurrentDate(now)
    setSelectedDate(now)
    setAgendaLimit(PAGE_SIZE)
    setExpandedDays([])
  }
  const selectDay = (date: Date) => {
    setSelectedDate(date)
    setAgendaLimit(PAGE_SIZE)
  }
  const openItem = (item: CalendarItem, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger
    setSelectedItem(item)
  }
  const changeDetailOpen = (open: boolean) => {
    if (open) return
    setSelectedItem(null)
    requestAnimationFrame(() => detailTriggerRef.current?.focus())
  }

  const selectedItems = itemsForCalendarDay(items, selectedDate)
  const nextItem = nextCalendarItem(items, new Date())
  const failedSources = failedCalendarSources(sources)
  const partial = failedSources.length > 0 && failedSources.length < 4

  return (
    <div className="space-y-4" data-testid="support-calendar-workspace" data-state={loading ? "loading" : error ? "error" : partial ? "partial" : "ready"}>
      <header className="flex items-start gap-3">
        <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1><HelpButton slug="agent-calendar" /></div><p className="mt-1 text-sm text-muted-foreground" data-testid="support-calendar-week-label">{weekLabel}</p></div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => changeWeek(-1)} aria-label={t("previousWeek")} data-testid="support-calendar-previous"><ChevronLeft /></Button>
          <Button variant="outline" className="hidden min-h-11 sm:inline-flex" onClick={goToday} data-testid="support-calendar-today">{t("today")}</Button>
          <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => changeWeek(1)} aria-label={t("nextWeek")} data-testid="support-calendar-next"><ChevronRight /></Button>
        </div>
      </header>
      <Button variant="outline" className="min-h-11 w-full sm:hidden" onClick={goToday} data-testid="support-calendar-today-mobile">{t("today")}</Button>

      {!loading && !error && <section aria-label={t("weekSummary")} className="flex flex-wrap divide-x rounded-xl border bg-card">
        {(["tickets", "tasks", "events", "activities"] as const).map((key) => <div key={key} className="min-w-[7rem] flex-1 p-3"><p className="text-lg font-semibold tabular-nums">{counts[key]}</p><p className="text-xs text-muted-foreground">{t(key)}</p></div>)}
      </section>}

      {!loading && !error && nextItem && <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => openItem(nextItem, event.currentTarget)} data-testid="support-calendar-next-item"><Clock className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="text-xs text-muted-foreground">{t("nextItem")}</span><span className="block truncate text-sm font-medium">{nextItem.title || t(itemConfig(nextItem.type).labelKey)} · {new Date(nextItem.date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span></span><ChevronRight /></button>}

      {!loading && !error && partial && <div role="status" className="flex items-start gap-2 rounded-lg border p-3 text-sm" data-testid="support-calendar-partial"><AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{t("partialTitle")}</p><p className="text-muted-foreground">{t("partialDescription", { sources: failedSources.map((source) => t(`sourceLabels.${source}`)).join(", ") })}</p><Button variant="ghost" className="mt-1 min-h-11 px-2" onClick={() => void fetchData()} data-testid="support-calendar-partial-retry"><RotateCcw />{t("retry")}</Button></div></div>}

      {loading ? (
        <div aria-busy="true" className="space-y-3 rounded-xl border p-4" data-testid="support-calendar-loading">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/30 motion-reduce:animate-none" />)}</div>
      ) : error ? (
        <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-xl border p-6 text-center" data-testid="support-calendar-error"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{error}</p>{errorRetryable && <Button variant="outline" className="mt-4 min-h-11" onClick={() => void fetchData()} data-testid="support-calendar-retry"><RotateCcw />{t("retry")}</Button>}</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 xl:hidden" role="tablist" aria-label={t("selectDay")}>
            {weekDates.map((date, index) => {
              const selected = isSameCalendarDay(date, selectedDate)
              const count = itemsForCalendarDay(items, date).length
              return <button key={date.toISOString()} type="button" role="tab" aria-selected={selected} onClick={() => selectDay(date)} className={`min-h-14 rounded-lg border px-1 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-muted/40 font-semibold" : ""}`} data-testid="support-calendar-day" data-date={calendarDateParam(date)}><span className="block text-[10px] text-muted-foreground sm:text-xs">{t(DAY_KEYS[index])}</span><span className="block text-sm">{date.getDate()}</span>{count > 0 && <span className="block text-[10px] text-muted-foreground" aria-label={t("itemCount", { count })}>{count}</span>}</button>
            })}
          </div>

          <section aria-labelledby="selected-day-title" className="rounded-xl border bg-card xl:hidden" data-testid="support-calendar-agenda">
            <div className="border-b p-3"><h2 id="selected-day-title" className="text-base font-semibold">{formatDateLocale(selectedDate, locale, { weekday: "long", day: "numeric", month: "long" })}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t("agendaHint")}</p></div>
            {selectedItems.length === 0 ? <div className="p-8 text-center" data-testid="support-calendar-empty-day"><CalendarDays className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{t("noItemsSelectedDay")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noItemsSelectedDayHint")}</p></div> : <div className="space-y-2 p-3">{selectedItems.slice(0, agendaLimit).map((item) => <CalendarItemButton key={`${item.type}-${item.id}`} item={item} onOpen={openItem} />)}{selectedItems.length > agendaLimit && <Button variant="outline" className="min-h-11 w-full" onClick={() => setAgendaLimit((current) => current + PAGE_SIZE)} data-testid="support-calendar-agenda-show-more">{t("showMore", { count: selectedItems.length - agendaLimit })}</Button>}</div>}
          </section>

          <section aria-label={t("weekBoard")} className="hidden grid-cols-7 divide-x rounded-xl border bg-card xl:grid" data-testid="support-calendar-week-board">
            {weekDates.map((date, index) => {
              const dayItems = itemsForCalendarDay(items, date)
              const key = calendarDateParam(date)
              const expanded = expandedDays.includes(key)
              const visible = expanded ? dayItems : dayItems.slice(0, 6)
              return <div key={key} className="min-w-0"><button type="button" className={`min-h-14 w-full border-b p-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isSameCalendarDay(date, new Date()) ? "bg-muted/30" : ""}`} onClick={() => selectDay(date)}><span className="block text-xs text-muted-foreground">{t(DAY_KEYS[index])}</span><span className="text-sm font-semibold">{date.getDate()}</span><span className="ml-2 text-xs text-muted-foreground">{t("itemCount", { count: dayItems.length })}</span></button><div className="space-y-2 p-2">{visible.map((item) => <CalendarItemButton key={`${item.type}-${item.id}`} item={item} onOpen={openItem} compact />)}{dayItems.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">{t("freeDay")}</p>}{dayItems.length > 6 && <Button variant="ghost" className="min-h-11 w-full text-xs" onClick={() => setExpandedDays((current) => expanded ? current.filter((day) => day !== key) : [...current, key])} data-testid="support-calendar-week-show-more" data-date={key}>{expanded ? t("showLess") : t("showMore", { count: dayItems.length - 6 })}</Button>}</div></div>
            })}
          </section>
        </>
      )}

      <ItemDetailSheet item={selectedItem} onOpenChange={changeDetailOpen} onNavigate={(url) => router.push(url)} />
    </div>
  )
}
