/**
 * The dense inbox (owner, 2026-11-15, by the omni-channel reel mock-up:
 * «продукт должен выглядеть так же»). Pure pieces the inbox screen reads, so
 * the rules live in one place and are tested without rendering the page:
 *
 *  - which conversations wait for our answer («Cavab gözləyir»);
 *  - who answers a conversation (a colleague or the AI) and its coloured labels;
 *  - where the thread puts a «12 noyabr · Instagram» line (a new day or another channel);
 *  - the channel chips over a thread and how many messages each holds;
 *  - the «Bu gün» card: today's incoming messages, the change against the same
 *    hour yesterday, seven days of bars and the usual first-reply time.
 *
 * Every number here is counted from data the inbox already has. The mock-up's
 * numbers were invented; where nothing was counted the screen shows nothing
 * rather than a zero that looks like a measurement.
 */

/* ── Cavab gözləyir ── */

/**
 * A conversation waits for our answer when the customer wrote last. Status is
 * the tab's business (an answered-by-nobody closed thread is still «closed»).
 */
export function isAwaitingReply(c: { lastDirection?: string | null }): boolean {
  return c.lastDirection === "inbound"
}

/* ── Who answers ── */

export type Responder =
  | { kind: "agent"; id: string; name: string }
  | { kind: "ai" }

/**
 * Who answers this conversation, as the list row shows it: the colleague it is
 * assigned to, else the AI when the auto-reply has answered in it, else nobody.
 * An assignee the agents list does not know (left the company) still shows,
 * as «?», because the conversation IS assigned.
 */
export function conversationResponder(
  c: { assignedTo?: string | null; botHandled?: boolean },
  agents: { id: string; name: string | null }[],
): Responder | null {
  if (c.assignedTo) {
    const agent = agents.find((a) => a.id === c.assignedTo)
    return { kind: "agent", id: c.assignedTo, name: agent?.name?.trim() || "?" }
  }
  if (c.botHandled) return { kind: "ai" }
  return null
}

/* ── Row labels ── */

export type ChipTone = "orange" | "green" | "blue" | "violet" | "red" | "amber" | "pink" | "teal" | "gray"

/**
 * Tones a label can take — never red («waits for our answer»), orange (the customer's stage) or
 * violet (the AI), so a label never reads as one of those.
 */
const TAG_TONES: ChipTone[] = ["blue", "amber", "green", "pink", "teal", "gray"]

/** The same label is the same colour in every row and in the rail. */
export function tagTone(tag: string): ChipTone {
  let hash = 0
  const key = tag.trim().toLowerCase()
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return TAG_TONES[Math.abs(hash) % TAG_TONES.length]
}

/** Tailwind classes per tone (literal strings so they survive the build). */
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
  red: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  pink: "bg-pink-50 text-pink-700 dark:bg-pink-950/30 dark:text-pink-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300",
  gray: "bg-muted text-muted-foreground",
}

/** The dot beside a label in the rail, same hue as its chip. */
export const TAG_DOT_CLASS: Record<ChipTone, string> = {
  orange: "bg-orange-500",
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
  gray: "bg-slate-400",
}

export interface RowChip {
  key: string
  text: string
  tone: ChipTone
  /** The «AI cavabladı» chip carries the sparkles mark. */
  ai?: boolean
}

/**
 * The coloured labels under a list row, in the order a person scans them:
 * «waits for our answer» (only when the row is read — an unread row already
 * shows its count), the customer's stage, the conversation's labels, and
 * «AI cavabladı». At most `max` chips; the rest is a «+N».
 */
export function conversationRowChips(
  c: {
    lastDirection?: string | null
    unreadCount?: number
    conversationTags?: string[]
    botHandled?: boolean
  },
  text: { awaiting: string; stage: string | null; aiAnswered: string },
  max = 3,
): { chips: RowChip[]; more: number } {
  const all: RowChip[] = []
  if (isAwaitingReply(c) && !(c.unreadCount && c.unreadCount > 0)) {
    all.push({ key: "awaiting", text: text.awaiting, tone: "red" })
  }
  if (text.stage) all.push({ key: "stage", text: text.stage, tone: "orange" })
  for (const tag of c.conversationTags ?? []) {
    const label = tag.trim()
    if (label) all.push({ key: `tag:${label}`, text: label, tone: tagTone(label) })
  }
  if (c.botHandled) all.push({ key: "ai", text: text.aiAnswered, tone: "violet", ai: true })
  // «AI cavabladı» is the one label the row must never hide behind «+N».
  const ai = all.find((chip) => chip.ai)
  const rest = all.filter((chip) => !chip.ai)
  const room = Math.max(0, max - (ai ? 1 : 0))
  const shown = [...rest.slice(0, room), ...(ai ? [ai] : [])]
  return { chips: shown, more: all.length - shown.length }
}

/** How many open conversations carry each label, most used first. */
export function labelCounts(conversations: { conversationTags?: string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const c of conversations) {
    for (const raw of new Set(c.conversationTags ?? [])) {
      const tag = raw.trim()
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/* ── Thread: channel chips and the day / channel line ── */

/** Messages per channel in this thread, most first; the calls go last as «voip». */
export function threadChannelCounts(
  messages: { channelType?: string | null }[],
  callCount: number,
): { channel: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of messages) {
    const ch = m.channelType || ""
    if (!ch || ch === "voip") continue
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  const list = [...counts.entries()]
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel))
  const calls = callCount + messages.filter((m) => m.channelType === "voip").length
  if (calls > 0) list.push({ channel: "voip", count: calls })
  return list
}

/** The calendar day of a moment, in the browser's time zone (or the one given). */
export function dayKey(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

export interface ThreadMark {
  at: number
  /** Null for an internal note: it belongs to no channel and does not change one. */
  channel: string | null
}

export interface ThreadSeparator {
  day: string
  /** The channel the next items came through; null before the first channelled item. */
  channel: string | null
}

/**
 * Where the thread draws a «12 noyabr · Instagram» line: before the first item,
 * and wherever the day or the channel changes. Index i of the result is the
 * line to draw before item i, or null. A note never starts a channel run, so a
 * note between two Instagram messages does not repeat the line.
 */
export function threadSeparators(items: ThreadMark[], timeZone?: string): (ThreadSeparator | null)[] {
  let lastDay: string | null = null
  let lastChannel: string | null = null
  return items.map((item) => {
    const day = dayKey(item.at, timeZone)
    const channel = item.channel ?? lastChannel
    const newDay = day !== lastDay
    const newChannel = item.channel !== null && item.channel !== lastChannel
    lastDay = day
    if (item.channel !== null) lastChannel = item.channel
    return newDay || newChannel ? { day, channel } : null
  })
}

/** «Bu gün», «Dünən» or the date («12 noyabr»; the year only when it is not this one). */
export function separatorDayLabel(
  day: string,
  nowMs: number,
  words: { today: string; yesterday: string },
  formatDay: (date: Date, withYear: boolean) => string,
  timeZone?: string,
): string {
  const today = dayKey(nowMs, timeZone)
  if (day === today) return words.today
  if (day === shiftDayKey(today, -1)) return words.yesterday
  const [y, m, d] = day.split("-").map(Number)
  return formatDay(new Date(y, m - 1, d, 12), day.slice(0, 4) !== today.slice(0, 4))
}

/** A YYYY-MM-DD key `days` calendar days away — plain calendar arithmetic, no clock involved. */
export function shiftDayKey(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/* ── «Bu gün» card ── */

/** Local midnight `offsetDays` from today (0 = today, -1 = yesterday), in the browser's zone. */
export function localDayStart(nowMs: number, offsetDays = 0): Date {
  const now = new Date(nowMs)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, 0, 0, 0, 0)
}

/** YYYY-MM-DD of a local date. */
export function localDayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export interface TodayCardModel {
  today: number
  /** Against yesterday up to the same hour; null when yesterday had nothing to compare with. */
  deltaPct: number | null
  /** Seven days, oldest first; the last one is today. */
  bars: { day: string; value: number }[]
  /** The usual (median) first-reply time today, in minutes; null when nobody was answered yet. */
  medianFirstReplyMinutes: number | null
}

/**
 * The card's numbers from what the reports return. Null when there is nothing
 * to show at all — no incoming message in seven days — so the screen draws no
 * card instead of seven empty bars and a zero.
 */
export function todayCardModel(input: {
  nowMs: number
  trend: { date: string; inbound: number }[]
  yesterdaySoFar: number | null
  firstReply: { answered: number; medianMinutes: number | null } | null
}): TodayCardModel | null {
  const byDay = new Map(input.trend.map((r) => [r.date.slice(0, 10), Number(r.inbound) || 0]))
  const bars = Array.from({ length: 7 }, (_, i) => {
    const day = localDayKey(localDayStart(input.nowMs, i - 6))
    return { day, value: byDay.get(day) ?? 0 }
  })
  if (bars.every((b) => b.value === 0)) return null
  const today = bars[6].value
  const y = input.yesterdaySoFar
  const deltaPct = y != null && y > 0 ? Math.round(((today - y) / y) * 100) : null
  const median = input.firstReply && input.firstReply.answered > 0 ? input.firstReply.medianMinutes : null
  return {
    today,
    deltaPct,
    bars,
    medianFirstReplyMinutes: median != null && Number.isFinite(median) && median >= 0 ? median : null,
  }
}

/** «1 dəq 40 san», «2 saat 5 dəq», «35 san» — the words come from the screen's language. */
export function formatReplyDuration(
  minutes: number,
  words: { hoursMinutes: (h: number, m: number) => string; minutesSeconds: (m: number, s: number) => string; seconds: (s: number) => string },
): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60))
  if (totalSeconds < 60) return words.seconds(totalSeconds)
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60)
    return words.minutesSeconds(m, totalSeconds - m * 60)
  }
  const totalMinutes = Math.round(totalSeconds / 60)
  const h = Math.floor(totalMinutes / 60)
  return words.hoursMinutes(h, totalMinutes - h * 60)
}
