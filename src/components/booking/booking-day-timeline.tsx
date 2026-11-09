"use client"

/**
 * The day a meeting actually sits in: a week strip to choose the day, chips to
 * choose whose day it is, then the day itself on an hour rail — each meeting a
 * block as long as it lasts, the free windows dashed between them, and a line
 * where "now" is.
 *
 * Why a rail and not a third list: the list answers "what is next", the month
 * grid answers "which day". Neither answers "is there room at 14:00", and that
 * is the question someone asks while the client is still on the phone.
 *
 * Geometry is in minutes from the day's midnight on the organization's clock,
 * so a meeting's block starts where its time starts and not where its string
 * sorts. Overlapping blocks stand side by side, the way a calendar shows two
 * colleagues busy at once — the alternative hides one of them. The one block
 * drawn over another is the time being taken when it clashes: it is offset to
 * the right so the name underneath it stays readable, because that name is
 * exactly what the person has to read before deciding.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarPlus, Clock3, TriangleAlert, Users } from "lucide-react"
import { Hint, HintValue } from "@/components/hint"
import { cn } from "@/lib/utils"

export const PIXELS_PER_HOUR = 96
const RAIL_WIDTH = "4rem"
const MINUTE_MS = 60_000
/** Below this a block has room for one line only, so the time moves beside the name and who meets is dropped. */
const COMPACT_BLOCK_PX = 44
/** A clashing block starts here, so the name of what it clashes with stays visible. */
const CLASH_OFFSET = "34%"

export interface TimelineSpan {
  start: number
  end: number
}

export interface TimelineMeeting extends TimelineSpan {
  id: string
  name: string
  status: string
  subtitle: string
  /** A reminder went out before this visit, and whether the client answered it. */
  reminded?: boolean
  confirmed?: boolean
}

export interface TimelineWindow extends TimelineSpan {
  startsAt: string
}

/**
 * Time the host is taken by something that is not a meeting of this section:
 * a CRM task given a time, or their connected calendar. The rail draws it
 * grey, the way a calendar shows a block it cannot open — without it the hour
 * looks free on screen while the booking form keeps refusing it.
 */
export interface TimelineBusy extends TimelineSpan {
  /**
   * What this hour is taken by, when the reader is entitled to know: the
   * event's own title from the calendar it was arranged in. Without it the
   * block says only «busy» — which is all another person's private calendar
   * may say.
   */
  label?: string
  /** Which connected calendar it came from, named on the block. */
  source?: "google" | "microsoft"
}

/** White text sits on each of these at 4.5:1 or better. */
const AVATAR_TONES = ["bg-violet-600", "bg-sky-700", "bg-emerald-700", "bg-rose-600", "bg-indigo-600", "bg-teal-700"]

export function avatarTone(seed: string): string {
  let sum = 0
  for (const character of seed) sum = (sum + (character.codePointAt(0) ?? 0)) % 9973
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

export function nameInitials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0] ?? "").join("")
  return letters ? letters.toLocaleUpperCase() : "?"
}

export function BookingAvatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  return <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-white", avatarTone(seed ?? name), className ?? "h-7 w-7 text-[11px]")}>{nameInitials(name)}</span>
}

const BLOCK_TONES: Record<string, { fill: string; bar: string }> = {
  confirmed: { fill: "bg-primary/[0.07] dark:bg-primary/15", bar: "bg-primary" },
  completed: { fill: "bg-emerald-50 dark:bg-emerald-950/50", bar: "bg-emerald-600 dark:bg-emerald-400" },
  no_show: { fill: "bg-amber-50 dark:bg-amber-950/50", bar: "bg-amber-500 dark:bg-amber-400" },
  cancelled: { fill: "bg-muted", bar: "bg-slate-300 dark:bg-slate-600" },
}

function blockTone(status: string) {
  return BLOCK_TONES[status] ?? { fill: "bg-muted", bar: "bg-border" }
}

export function timelineBlockTone(status: string): string {
  const tone = blockTone(status)
  return `${tone.fill} ${tone.bar}`
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
 * What is left of a span once the blocks drawn over it are cut out. A busy
 * hour that a meeting already fills needs no second block; an hour half
 * covered still has to show the half that is taken.
 */
export function subtractSpans<T extends TimelineSpan>(span: TimelineSpan, blocks: T[]): TimelineSpan[] {
  let parts: TimelineSpan[] = [{ ...span }]
  for (const block of [...blocks].sort((left, right) => left.start - right.start)) {
    const next: TimelineSpan[] = []
    for (const part of parts) {
      if (block.end <= part.start || block.start >= part.end) { next.push(part); continue }
      if (block.start > part.start) next.push({ start: part.start, end: block.start })
      if (block.end < part.end) next.push({ start: block.end, end: part.end })
    }
    parts = next
  }
  return parts.filter((part) => part.end > part.start)
}

/** The meetings a span would land on top of. */
export function spansClashing<T extends TimelineSpan>(span: TimelineSpan | null, items: T[]): T[] {
  if (!span) return []
  return items.filter((item) => item.start < span.end && span.start < item.end)
}

/**
 * The hours the rail draws: exactly the ones the day uses, rounded out to the
 * hour. It hugs the content rather than filling a fixed 09:00–19:00 working
 * day — a day that ends at 15:30 drew three and a half empty hours under
 * itself, and that empty tail is most of what the screen showed.
 *
 * The fallback is for a day with nothing at all, which the screen replaces
 * with an empty state anyway.
 */
const MIN_RAIL_HOURS = 3

export function railRange(spans: TimelineSpan[], fallback: { from: number; to: number } = { from: 9, to: 19 }): { from: number; to: number } {
  if (!spans.length) return fallback
  let from = Infinity
  let to = -Infinity
  for (const span of spans) {
    from = Math.min(from, Math.floor(span.start / 60) * 60)
    to = Math.max(to, Math.ceil(span.end / 60) * 60)
  }
  const low = Math.max(0, Math.min(from, 24 * 60 - MIN_RAIL_HOURS * 60))
  const high = Math.min(24 * 60, Math.max(to, low + MIN_RAIL_HOURS * 60))
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
      const quiet = weekend && !count && !loading
      return <button
        type="button"
        key={day}
        onClick={() => onSelect(day)}
        aria-pressed={chosen}
        // The chosen day is filled on purpose — it is the one thing the eye
        // looks for in the strip. `data-crm-filter` would answer the button
        // guard too, but it carries the shared white-chip look
        // ([data-crm-filter] in crm-workspace.css) and would strip the fill,
        // the radius and the shadow. A colour role says the same thing to the
        // guard and leaves the paint alone.
        data-crm-color-role="toggle"
        className={cn(
          "min-h-20 rounded-xl border px-1 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[5.5rem] sm:px-2",
          chosen ? "border-primary bg-primary text-primary-foreground shadow-[0_8px_18px_-10px_hsl(var(--primary))]"
            : quiet ? "border-border/70 bg-transparent" : "border-border bg-card hover:border-primary/50",
        )}
      >
        <span className={cn("block text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]", chosen ? "text-primary-foreground/85" : quiet ? "text-muted-foreground/60" : "text-muted-foreground")}>{weekdayLabel(day)}</span>
        <span className={cn("mt-0.5 block text-lg font-bold tabular-nums sm:text-xl", quiet ? "text-muted-foreground/60" : "")}>{dayNumber(day)}</span>
        {quiet ? <span className="mt-1 block text-[10px] text-muted-foreground/60">{t("dayOff")}</span> : <span className="mt-1.5 flex min-h-2 items-center justify-center gap-[3px]" aria-hidden="true">
          {/* Three dots and a number: a phone gives each day about 44 px, and a
              fourth dot squeezes the row until the dots are drawn as slivers. */}
          {loading ? <span className={cn("text-[11px] leading-none", chosen ? "text-primary-foreground/70" : "text-muted-foreground")}>…</span> : Array.from({ length: Math.min(count, 3) }, (_, index) => <span key={index} className={cn("h-1 w-1 shrink-0 rounded-full", chosen ? "bg-primary-foreground" : "bg-primary")} />)}
          {!loading && count > 3 ? <span className={cn("shrink-0 text-[10px] font-semibold leading-none tabular-nums", chosen ? "text-primary-foreground" : "text-primary")}>+{count - 3}</span> : null}
        </span>}
        {day === today && !chosen ? <span className="mt-0.5 block text-[10px] font-semibold text-primary">{t("dayToday")}</span> : null}
        <span className="sr-only">{count ? t("dayCount", { count }) : t("dayEmpty")}{day === today ? ` · ${t("dayToday")}` : ""}</span>
      </button>
    })}
  </div>
}

export interface HostChip {
  id: string
  name: string
  meta: string
  /** Meetings on the shown day — what decides whether this chip earns its row. */
  count: number
}

/** Above this many colleagues the row stops being a filter and becomes a wall. */
const CHIPS_ALWAYS_SHOWN = 6

/**
 * Whose day the rail shows. A chip instead of a select because the count beside
 * each name is the reason to pick one, and a closed select hides every count.
 *
 * But that count is also what makes most of them not worth a row: an
 * organization with thirty colleagues got thirty chips reading «0 meetings»,
 * and they pushed the day itself off the screen. So the row holds whoever has
 * something that day, plus the one chosen, and the rest wait behind a single
 * button. A small team is shown whole — collapsing four names helps nobody.
 */
export function BookingHostChips({ hosts, anyMeta, selected, onSelect }: {
  hosts: HostChip[]
  anyMeta: string
  selected: string
  onSelect: (id: string) => void
}) {
  const t = useTranslations("booking")
  const [expanded, setExpanded] = useState(false)
  const chip = (active: boolean) => cn(
    "flex min-h-11 max-w-full items-center gap-2.5 rounded-full border py-1 pl-1.5 pr-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-primary bg-primary/5 ring-1 ring-inset ring-primary" : "border-border bg-card hover:border-primary/50",
  )
  // Everyone, while the team is small or the row is open; otherwise the ones
  // with meetings today and the selected one, so the filter can be undone.
  const big = hosts.length > CHIPS_ALWAYS_SHOWN
  const shown = expanded || !big ? hosts : hosts.filter((host) => host.count > 0 || host.id === selected)
  const hidden = hosts.length - shown.length
  const collapsible = big && (hidden > 0 || expanded)
  return <div className="flex flex-wrap gap-2" role="group" aria-label={t("colHosts")}>
    <button type="button" data-crm-filter="" data-state={selected ? "inactive" : "active"} aria-pressed={!selected} onClick={() => onSelect("")} className={chip(!selected)}>
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="h-4 w-4" /></span>
      <span className="min-w-0 truncate text-sm"><span className="font-semibold">{t("availableTeam")}</span>{anyMeta ? <span className="ml-1.5 text-muted-foreground">{anyMeta}</span> : null}</span>
    </button>
    {shown.map((host) => <button type="button" key={host.id} data-crm-filter="" data-state={selected === host.id ? "active" : "inactive"} aria-pressed={selected === host.id} onClick={() => onSelect(host.id)} className={chip(selected === host.id)}>
      <BookingAvatar name={host.name} className="h-8 w-8 text-xs" />
      <span className="min-w-0 truncate text-sm"><span className="font-semibold">{host.name}</span>{host.meta ? <span className="ml-1.5 text-muted-foreground">{host.meta}</span> : null}</span>
    </button>)}
    {collapsible ? (
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-11 items-center rounded-full border border-dashed border-border px-4 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? t("hostsFewer") : t("hostsMore", { count: hidden })}
      </button>
    ) : null}
  </div>
}

export function BookingDayTimeline({ meetings, windows, busy, nowMinutes, selectedId, pendingStart, pendingEnd, onSelect, onBook, time, statusLabel, duration }: {
  meetings: TimelineMeeting[]
  windows: TimelineWindow[]
  /** Already stripped of the spans the meetings above cover. */
  busy: TimelineBusy[]
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
  const pending = pendingStart !== null && pendingEnd !== null ? { start: pendingStart, end: pendingEnd } : null
  const clashes = spansClashing(pending, meetings.filter((meeting) => meeting.status !== "cancelled"))
  const rail = railRange([...meetings, ...(pending ? [pending] : []), ...windows, ...busy])
  const marks = Array.from({ length: (rail.to - rail.from) * 2 + 1 }, (_, index) => rail.from * 60 + index * 30)
  const placed = packSpans(meetings)

  return <div className="relative" style={{ height: (rail.to - rail.from) * PIXELS_PER_HOUR + 24 }} aria-label={t("chooseTime")}>
    {marks.map((minute) => <div key={minute} className="absolute inset-x-0 flex items-start" style={{ top: offsetStyle(minute, rail.from) }}>
      <span className="-mt-2 shrink-0 pr-3 text-right text-[11px] tabular-nums text-muted-foreground" style={{ width: RAIL_WIDTH }}>{time(minute)}</span>
      <span aria-hidden="true" className={cn("mt-0 h-px flex-1", minute % 60 === 0 ? "bg-border" : "bg-border/50")} />
    </div>)}
    <div className="absolute inset-y-0 right-0" style={{ left: RAIL_WIDTH }}>
      {windows.map((window) => {
        // The whole window is the target, not a button inside it: a 30-minute
        // window is 44 px tall, and a button that still met the page’s own
        // 44 px minimum would not fit inside one.
        const height = Math.max(((window.end - window.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        const frame = { top: offsetStyle(window.start, rail.from), height, minHeight: height, minWidth: 0 }
        // While a time inside this window is being taken, the proposed block
        // is drawn over it and carries the times; two labels in one place read
        // as one garbled line.
        const covered = pendingStart !== null && pendingStart >= window.start && pendingStart < window.end
        // A native button centres its content; a tall window would then put
        // its one line in the middle, behind whatever block sits there.
        const inside = <span className="flex w-full min-w-0 items-center justify-between gap-x-3">
          {covered ? null : <span className="min-w-0 truncate text-xs font-semibold text-primary">
            {t("freeWindow")}
            <span className="ml-2 font-medium tabular-nums text-muted-foreground">{time(window.start)}–{time(window.end)}</span>
            <span className="ml-2 font-normal text-muted-foreground">{duration(window.end - window.start)}</span>
          </span>}
          {onBook && pendingStart === null ? <span className="flex shrink-0 items-center gap-1 truncate text-xs font-semibold text-primary">
            <CalendarPlus aria-hidden="true" className="h-4 w-4 shrink-0" />{t("createMeeting")}
          </span> : null}
        </span>
        const shell = "absolute left-0 right-1 flex items-start overflow-hidden rounded-xl border-[1.5px] border-dashed border-primary/45 px-3.5 py-2 text-left"
        if (!onBook || pendingStart !== null) return <div key={`free:${window.startsAt}`} className={shell} style={frame}>{inside}</div>
        return <Hint key={`free:${window.startsAt}`} text={t("bookForClient", { time: time(window.start) })}>
          <button
            type="button"
            data-testid="timeline-window"
            onClick={() => onBook(window.startsAt)}
            className={cn(shell, "transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            style={frame}
          >
            {inside}
          </button>
        </Hint>
      })}
      {busy.map((span) => {
        const height = Math.max(((span.end - span.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        return <div
          key={`busy:${span.start}`}
          data-testid="timeline-busy"
          className="absolute left-0 right-1 flex items-start overflow-hidden rounded-xl bg-muted px-3.5 py-2"
          style={{ top: offsetStyle(span.start, rail.from), height, minHeight: height }}
        >
          <span className="flex w-full min-w-0 items-center justify-between gap-x-3">
            <span className="min-w-0 truncate text-sm font-semibold text-muted-foreground">{span.label || t("busyBlock")}</span>
            <span className="flex shrink-0 items-center gap-2">
              {span.source ? <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                {t(span.source === "microsoft" ? "calendarOutlook" : "calendarGoogle")}
              </span> : null}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time(span.start)}–{time(span.end)}</span>
            </span>
          </span>
        </div>
      })}
      {placed.map(({ item, column, columns }) => {
        const height = Math.max(((item.end - item.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        const compact = height < COMPACT_BLOCK_PX
        // The page sets a 44 px minimum on every button; a block is as tall as
        // its meeting is long, so the minimum is pinned inline where it cannot
        // stretch a quarter-hour into three quarters.
        const frame = { top: offsetStyle(item.start, rail.from), height, minHeight: height, minWidth: 0, left: `${(column / columns) * 100}%`, width: `calc(${(1 / columns) * 100}% - 0.25rem)` }
        const chosen = item.id === selectedId
        const tone = blockTone(item.status)
        return <button
          type="button"
          key={item.id}
          onClick={() => onSelect(item.id)}
          aria-pressed={chosen}
          // Same as the day cell: the status tint and the filled chosen state
          // are the point of the block, so it declares a colour role rather
          // than taking the shared filter look.
          data-crm-color-role="toggle"
          data-testid="timeline-meeting"
          className={cn(
            "absolute overflow-hidden rounded-xl pl-3.5 pr-3 py-2 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            chosen ? "bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_hsl(var(--primary))]" : tone.fill,
          )}
          style={frame}
        >
          {chosen ? null : <span aria-hidden="true" className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-full", tone.bar)} />}
          <span className={cn("flex h-full min-w-0 items-start gap-2.5", compact ? "flex-row items-center" : "")}>
            {compact ? null : <BookingAvatar name={item.name} seed={item.id} className={cn("mt-0.5 h-[26px] w-[26px] text-[10px]", chosen ? "ring-2 ring-primary-foreground/30" : "")} />}
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm font-semibold", item.status === "cancelled" && !chosen ? "text-muted-foreground line-through" : "")}>{item.name}</span>
              {compact ? null : <span className={cn("mt-0.5 block truncate text-xs", chosen ? "text-primary-foreground/85" : "text-muted-foreground")}>
                <span className="tabular-nums">{time(item.start)}–{time(item.end)}</span>, {item.subtitle}
              </span>}
            </span>
            {compact ? <span className={cn("shrink-0 text-xs tabular-nums", chosen ? "text-primary-foreground/85" : "text-muted-foreground")}>{time(item.start)}–{time(item.end)}</span> : null}
          </span>
          <span className="sr-only">{statusLabel(item.status)}</span>
        </button>
      })}
      {pending ? (() => {
        const height = Math.max(((pending.end - pending.start) / 60) * PIXELS_PER_HOUR - 4, 26)
        // Offset only when it clashes: there it is drawn over the meeting, and
        // the left third keeps that meeting's avatar and name in sight.
        const frame = { top: offsetStyle(pending.start, rail.from), height, minHeight: height, minWidth: 0, left: clashes.length ? CLASH_OFFSET : "0%", right: "0.25rem", zIndex: 4 }
        return <div
          key="pending"
          role="status"
          data-testid="timeline-pending"
          className={cn(
            "absolute flex flex-col justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed px-3.5 py-2",
            clashes.length ? "border-destructive bg-destructive/5" : "border-primary bg-primary/10",
          )}
          style={frame}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", clashes.length ? "text-destructive" : "text-primary")}>
              {clashes.length ? t("clashRequested", { from: time(pending.start), to: time(pending.end) }) : t("newMeeting")}
            </span>
            {clashes.length ? <span className="flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-card px-2 py-0.5 text-[11px] font-bold text-destructive">
              <TriangleAlert aria-hidden="true" className="h-3 w-3" />{t("clashTag")}
            </span> : null}
          </span>
          <span className={cn("mt-0.5 truncate text-xs", clashes.length ? "text-destructive/85" : "text-primary/80")}>
            {clashes.length ? t("clashWith", { name: clashes[0].name }) : <span className="tabular-nums">{time(pending.start)}–{time(pending.end)}</span>}
          </span>
        </div>
      })() : null}
      {nowMinutes !== null && nowMinutes >= rail.from * 60 && nowMinutes <= rail.to * 60 ? <div className="pointer-events-none absolute inset-x-0 flex items-center" style={{ top: offsetStyle(nowMinutes, rail.from), zIndex: 5 }}>
        <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-primary" />
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary-foreground">{time(nowMinutes)}</span>
        <span className="sr-only">{t("nowAt", { time: time(nowMinutes) })}</span>
      </div> : null}
    </div>
  </div>
}

export function BookingDayLegend({ statuses, statusLabel }: { statuses: string[]; statusLabel: (status: string) => string }) {
  const t = useTranslations("booking")
  return <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t("workspaceStatus")}>
    {statuses.map((status) => <li key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-sm", blockTone(status).bar)} />
      {statusLabel(status)}
    </li>)}
  </ul>
}

export function BookingDaySummary({ meetings, windows, external = [], busyHint, windowsHint, duration }: {
  meetings: TimelineMeeting[]
  windows: TimelineWindow[]
  /** Blocks that came from a connected calendar, not from this section. */
  external?: TimelineBusy[]
  busyHint: string
  windowsHint: string
  duration: (minutes: number) => string
}) {
  const t = useTranslations("booking")
  const counted = meetings.filter((meeting) => meeting.status !== "cancelled")
  const busy = counted.reduce((total, meeting) => total + (meeting.end - meeting.start), 0)
  // How many of the day's clients said they are coming: the number the
  // reminders exist for, next to the day they belong to.
  const reminded = counted.filter((meeting) => meeting.reminded)
  const confirmed = reminded.filter((meeting) => meeting.confirmed)
  return <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
    <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />
    <span>{t("dayCount", { count: counted.length })}</span>
    {busy ? <>·<HintValue text={busyHint}>{t("dayBusy", { value: duration(busy) })}</HintValue></> : null}
    {windows.length ? <>·<HintValue text={windowsHint}>{t("windowCount", { count: windows.length })}</HintValue></> : null}
    {reminded.length ? <>·<HintValue text={t("dayConfirmedHint")}>{t("dayConfirmed", { confirmed: confirmed.length, reminded: reminded.length })}</HintValue></> : null}
    {external.length ? <>·<HintValue text={t("dayExternalHint")}>{t("dayExternal", { count: external.length })}</HintValue></> : null}
  </p>
}
