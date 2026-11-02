"use client"

/**
 * The day a meeting actually sits in: a week strip to choose the day, then the
 * day itself on an hour rail — each meeting a block as long as it lasts, the
 * free windows dashed between them, and a line where "now" is.
 *
 * Why a rail and not a third list: the list answers "what is next", the month
 * grid answers "which day". Neither answers "is there room at 14:00", and that
 * is the question someone asks while the client is still on the phone.
 *
 * Geometry is in minutes from the day's midnight on the organization's clock,
 * so a meeting's block starts where its time starts and not where its string
 * sorts. Overlapping blocks stand side by side, the way a calendar shows two
 * colleagues busy at once — the alternative hides one of them.
 */
import { useTranslations } from "next-intl"
import { CalendarPlus, Clock3 } from "lucide-react"
import { Hint, HintValue } from "@/components/hint"
import { cn } from "@/lib/utils"

export const PIXELS_PER_HOUR = 96
const RAIL_WIDTH = "3.5rem"
const MINUTE_MS = 60_000
/** Below this a block has room for one line only, so the time moves beside the name and who meets is dropped. */
const COMPACT_BLOCK_PX = 60

export interface TimelineSpan {
  start: number
  end: number
}

export interface TimelineMeeting extends TimelineSpan {
  id: string
  name: string
  status: string
  subtitle: string
}

export interface TimelineWindow extends TimelineSpan {
  startsAt: string
}

const BLOCK_TONES: Record<string, string> = {
  confirmed: "border-l-sky-600 bg-sky-50 dark:border-l-sky-400 dark:bg-sky-950/50",
  completed: "border-l-emerald-600 bg-emerald-50 dark:border-l-emerald-400 dark:bg-emerald-950/50",
  no_show: "border-l-amber-600 bg-amber-50 dark:border-l-amber-400 dark:bg-amber-950/50",
  cancelled: "border-l-slate-400 bg-muted dark:border-l-slate-500",
}

export function timelineBlockTone(status: string): string {
  return BLOCK_TONES[status] ?? "border-l-border bg-muted"
}

/** Minutes from the start of the day the rail draws. */
export function minutesFrom(dayStartMs: number, iso: string): number {
  return Math.round((Date.parse(iso) - dayStartMs) / MINUTE_MS)
}

/**
 * Consecutive free slots are one window to a human: 10:00, 10:30 and 11:00
 * with a 45-minute meeting on offer read as "free 10:00–12:15", not as three
 * separate offers. Slots may also overlap when the step is shorter than the
 * meeting, so a window grows while the next slot starts inside it.
 */
export function mergeFreeWindows(slots: { startsAt: string; endsAt: string }[], dayStartMs: number): TimelineWindow[] {
  const spans = slots
    .map((slot) => ({ startsAt: slot.startsAt, start: minutesFrom(dayStartMs, slot.startsAt), end: minutesFrom(dayStartMs, slot.endsAt) }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start)
  const windows: TimelineWindow[] = []
  for (const span of spans) {
    const last = windows[windows.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else windows.push({ ...span })
  }
  return windows
}

/**
 * Columns for blocks that share the same minutes. Only a cluster of blocks
 * that actually overlap is split, so a quiet day keeps full-width blocks.
 */
export function packSpans<T extends TimelineSpan>(items: T[]): { item: T; column: number; columns: number }[] {
  const sorted = [...items].sort((left, right) => left.start - right.start || left.end - right.end)
  const placed: { item: T; column: number; columns: number }[] = []
  let cluster: typeof placed = []
  let clusterEnd = -Infinity
  const closeCluster = () => {
    const columns = cluster.reduce((widest, entry) => Math.max(widest, entry.column + 1), 1)
    for (const entry of cluster) entry.columns = columns
    cluster = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) closeCluster()
    let column = 0
    while (cluster.some((entry) => entry.column === column && entry.item.end > item.start)) column += 1
    const entry = { item, column, columns: 1 }
    cluster.push(entry)
    placed.push(entry)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  closeCluster()
  return placed
}

/**
 * The hours the rail draws: the working day plus whatever sits outside it. A
 * fixed 09:00–19:00 rail would simply not show an 08:00 meeting.
 */
export function railRange(spans: TimelineSpan[], fallback: { from: number; to: number } = { from: 9, to: 19 }): { from: number; to: number } {
  let from = fallback.from * 60
  let to = fallback.to * 60
  for (const span of spans) {
    from = Math.min(from, Math.floor(span.start / 60) * 60)
    to = Math.max(to, Math.ceil(span.end / 60) * 60)
  }
  const low = Math.max(0, Math.min(from, to - 120))
  const high = Math.min(24 * 60, Math.max(to, low + 120))
  return { from: low / 60, to: high / 60 }
}

function offsetStyle(minutes: number, railFromHour: number) {
  return ((minutes - railFromHour * 60) / 60) * PIXELS_PER_HOUR
}

export function BookingWeekStrip({ days, counts, selectedDay, today, loading, onSelect, weekdayLabel, dayNumber }: {
  days: string[]
  counts: Record<string, number>
  selectedDay: string
  today: string
  loading: boolean
  onSelect: (day: string) => void
  weekdayLabel: (day: string) => string
  dayNumber: (day: string) => string
}) {
  const t = useTranslations("booking")
  return <div className="grid grid-cols-7 gap-2" role="group" aria-label={t("chooseDay")}>
    {days.map((day) => {
      const chosen = day === selectedDay
      const count = counts[day] ?? 0
      const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
      return <button
        type="button"
        key={day}
        onClick={() => onSelect(day)}
        aria-pressed={chosen}
        className={cn(
          "min-h-20 rounded-xl border px-1 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:px-2",
          chosen ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:border-primary/50",
        )}
      >
        <span className={cn("block text-[10px] font-medium uppercase tracking-wide sm:text-[11px]", chosen ? "text-primary-foreground/80" : weekend ? "text-muted-foreground/60" : "text-muted-foreground")}>{weekdayLabel(day)}</span>
        <span className="mt-0.5 block text-lg font-semibold tabular-nums sm:text-xl">{dayNumber(day)}</span>
        {day === today ? <span className={cn("block text-[10px] font-medium sm:text-[11px]", chosen ? "text-primary-foreground/80" : "text-primary")}>{t("dayToday")}</span> : null}
        <span className="mt-1 flex min-h-3 items-center justify-center gap-1" aria-hidden="true">
          {/* Three dots and a number: a phone gives each day about 44 px, and a
              fourth dot squeezes the row until the dots are drawn as slivers. */}
          {loading ? <span className={cn("text-[11px]", chosen ? "text-primary-foreground/70" : "text-muted-foreground")}>…</span> : Array.from({ length: Math.min(count, 3) }, (_, index) => <span key={index} className={cn("h-1.5 w-1.5 shrink-0 rounded-full", chosen ? "bg-primary-foreground/80" : "bg-primary")} />)}
          {!loading && count > 3 ? <span className={cn("shrink-0 text-[10px] font-medium tabular-nums", chosen ? "text-primary-foreground/80" : "text-primary")}>+{count - 3}</span> : null}
        </span>
        <span className="sr-only">{count ? t("dayCount", { count }) : t("dayEmpty")}</span>
      </button>
    })}
  </div>
}

export function BookingDayTimeline({ meetings, windows, nowMinutes, selectedId, pendingStart, pendingEnd, onSelect, onBook, time, statusLabel, duration }: {
  meetings: TimelineMeeting[]
  windows: TimelineWindow[]
  /** Minutes from midnight when the shown day is today, otherwise null. */
  nowMinutes: number | null
  selectedId: string | null
  pendingStart: number | null
  pendingEnd: number | null
  onSelect: (id: string) => void
  onBook: ((startsAt: string) => void) | null
  time: (minutes: number) => string
  statusLabel: (status: string) => string
  duration: (minutes: number) => string
}) {
  const t = useTranslations("booking")
  // One packing for meetings and the proposed time together: a block that only
  // knows about its own kind would be drawn on top of the meeting it clashes
  // with instead of beside it.
  const blocks: ({ start: number; end: number } & ({ kind: "meeting"; meeting: TimelineMeeting } | { kind: "pending" }))[] = [
    ...meetings.map((meeting) => ({ start: meeting.start, end: meeting.end, kind: "meeting" as const, meeting })),
    ...(pendingStart !== null && pendingEnd !== null ? [{ start: pendingStart, end: pendingEnd, kind: "pending" as const }] : []),
  ]
  const rail = railRange([...blocks, ...windows])
  const hours = Array.from({ length: rail.to - rail.from + 1 }, (_, index) => rail.from + index)
  const placed = packSpans(blocks)

  return <div className="relative" style={{ height: (rail.to - rail.from) * PIXELS_PER_HOUR + 24 }} aria-label={t("chooseTime")}>
    {hours.map((hour) => <div key={hour} className="absolute inset-x-0 flex items-start" style={{ top: (hour - rail.from) * PIXELS_PER_HOUR }}>
      <span className="-mt-2 shrink-0 pr-3 text-right text-xs tabular-nums text-muted-foreground" style={{ width: RAIL_WIDTH }}>{time(hour * 60)}</span>
      <span aria-hidden="true" className="mt-0 h-px flex-1 bg-border" />
    </div>)}
    <div className="absolute inset-y-0 right-0" style={{ left: RAIL_WIDTH }}>
      {windows.map((window) => {
        // The whole window is the target, not a button inside it: a 30-minute
        // window is 44 px tall, and a button that still met the page’s own
        // 44 px minimum would not fit inside one.
        const height = Math.max(((window.end - window.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        const compact = height < COMPACT_BLOCK_PX
        const frame = { top: offsetStyle(window.start, rail.from), height, minHeight: height, minWidth: 0 }
        // While a time inside this window is being taken, the proposed block
        // is drawn over it and carries the times; two labels in one place read
        // as one garbled line.
        const covered = pendingStart !== null && pendingStart >= window.start && pendingStart < window.end
        const inside = <span className={cn("flex h-full min-w-0 gap-x-2", compact ? "flex-row items-center justify-between" : "flex-col items-start gap-1")}>
          {covered ? null : <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            <span className="tabular-nums">{time(window.start)}–{time(window.end)}</span>
            <span className="ml-2 text-muted-foreground/80">{duration(window.end - window.start)}</span>
          </span>}
          {onBook && pendingStart === null ? <span className="flex shrink-0 items-center gap-1 truncate text-xs font-semibold text-primary">
            <CalendarPlus aria-hidden="true" className="h-4 w-4 shrink-0" />{t("createMeeting")}
          </span> : null}
        </span>
        const shell = "absolute left-0 right-1 overflow-hidden rounded-lg border border-dashed border-primary/50 bg-primary/5 px-3 py-1.5 text-left"
        if (!onBook || pendingStart !== null) return <div key={`free:${window.startsAt}`} className={shell} style={frame}>{inside}</div>
        return <Hint key={`free:${window.startsAt}`} text={t("bookForClient", { time: time(window.start) })}>
          <button
            type="button"
            data-testid="timeline-window"
            onClick={() => onBook(window.startsAt)}
            className={cn(shell, "transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            style={frame}
          >
            {inside}
          </button>
        </Hint>
      })}
      {placed.map(({ item, column, columns }) => {
        const height = Math.max(((item.end - item.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        const compact = height < COMPACT_BLOCK_PX
        // The page sets a 44 px minimum on every button; a block is as tall as
        // its meeting is long, so the minimum is pinned inline where it cannot
        // stretch a quarter-hour into three quarters.
        const frame = { top: offsetStyle(item.start, rail.from), height, minHeight: height, minWidth: 0, left: `${(column / columns) * 100}%`, width: `calc(${(1 / columns) * 100}% - 0.25rem)` }
        if (item.kind === "pending") return <div
          key="pending"
          role="status"
          className="absolute flex flex-col justify-center overflow-hidden rounded-lg border-2 border-dashed border-primary bg-primary/10 px-3 py-1.5"
          style={frame}
        >
          <p className="truncate text-sm font-semibold text-primary">{t("newMeeting")}</p>
          <p className="truncate text-xs tabular-nums text-primary/80">{time(item.start)}–{time(item.end)}</p>
        </div>
        const meeting = item.meeting
        const chosen = meeting.id === selectedId
        return <button
          type="button"
          key={meeting.id}
          onClick={() => onSelect(meeting.id)}
          aria-pressed={chosen}
          data-testid="timeline-meeting"
          className={cn(
            "absolute overflow-hidden rounded-lg border border-border border-l-4 px-3 py-1.5 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            timelineBlockTone(meeting.status),
            chosen ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
          )}
          style={frame}
        >
          <span className={cn("flex h-full min-w-0 gap-x-2", compact ? "flex-row items-center justify-between" : "flex-col justify-between")}>
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm font-semibold", meeting.status === "cancelled" ? "text-muted-foreground line-through" : "")}>{meeting.name}</span>
              {compact ? null : <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meeting.subtitle}</span>}
            </span>
            <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", compact ? "" : "mt-auto")}>{time(meeting.start)}–{time(meeting.end)}</span>
          </span>
          <span className="sr-only">{statusLabel(meeting.status)}</span>
        </button>
      })}
      {nowMinutes !== null && nowMinutes >= rail.from * 60 && nowMinutes <= rail.to * 60 ? <div className="pointer-events-none absolute inset-x-0 flex items-center" style={{ top: offsetStyle(nowMinutes, rail.from) }}>
        <span aria-hidden="true" className="h-0.5 flex-1 bg-primary" />
        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground">{time(nowMinutes)}</span>
        <span className="sr-only">{t("nowAt", { time: time(nowMinutes) })}</span>
      </div> : null}
    </div>
  </div>
}

export function BookingDayLegend({ statuses, statusLabel }: { statuses: string[]; statusLabel: (status: string) => string }) {
  const t = useTranslations("booking")
  return <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t("workspaceStatus")}>
    {statuses.map((status) => <li key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-sm border-l-4", timelineBlockTone(status))} />
      {statusLabel(status)}
    </li>)}
  </ul>
}

export function BookingDaySummary({ meetings, windows, busyHint, windowsHint, duration }: {
  meetings: TimelineMeeting[]
  windows: TimelineWindow[]
  busyHint: string
  windowsHint: string
  duration: (minutes: number) => string
}) {
  const t = useTranslations("booking")
  const counted = meetings.filter((meeting) => meeting.status !== "cancelled")
  const busy = counted.reduce((total, meeting) => total + (meeting.end - meeting.start), 0)
  return <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
    <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />
    <span>{t("dayCount", { count: counted.length })}</span>
    {busy ? <>·<HintValue text={busyHint}>{t("dayBusy", { value: duration(busy) })}</HintValue></> : null}
    {windows.length ? <>·<HintValue text={windowsHint}>{t("windowCount", { count: windows.length })}</HintValue></> : null}
  </p>
}
