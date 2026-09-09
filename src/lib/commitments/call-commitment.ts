import type { ActionItem, ConversationInsight } from "@/lib/conversation-intel/types"
import { getOffsetMinutes } from "@/lib/timezone"

/**
 * Turning what was promised on a call into something that can be missed.
 *
 * The call analyser already extracts commitments and shows them on the lead
 * card under a heading that says "Tasks". They were never tasks: on 2026-08-14
 * a lead carried an extracted commitment — "the sales manager must contact the
 * customer at 18:00 today" — while the same card reported "tasks to do: 0", and
 * nothing in the codebase turned one into the other. A promise made to a
 * customer existed only as a sentence nobody was accountable for.
 *
 * Two rules decide what becomes a task, and both exist to keep this from
 * degenerating into noise the sales team learns to ignore:
 *
 *  - only OUR commitments. An action item attributed to the customer ("the
 *    customer will send measurements") is not work we can be late on, and a
 *    task for it would be a reminder to nag. Unattributed items are treated as
 *    ours: a forgotten promise costs more than a task somebody closes in one
 *    click.
 *  - a deadline is only a deadline when the customer named one. The analyser
 *    returns the phrase it heard, not a date, and guessing a time from "next
 *    week" produces an overdue alarm nobody agreed to. Only unambiguous phrases
 *    are converted; everything else gets a default window, marked plainly as
 *    ours rather than theirs — because the first false accusation of lateness
 *    is the moment a salesperson stops trusting the whole mechanism.
 */

export type CommitmentDue = {
  dueDate: Date
  /**
   * exact       — a clock or a delay the customer named ("18:00", "in an hour")
   * approximate — a day or a part of one ("tomorrow", "tomorrow morning")
   * default     — nothing usable was said; the window below is ours
   *
   * Three values rather than a boolean because two of them are true statements
   * about the customer and one is a statement about us, and collapsing them
   * made the task claim a minute nobody agreed to.
   */
  precision: "exact" | "approximate" | "default"
  /** True when the customer said something about time at all. */
  statedByCustomer: boolean
}

/**
 * How long we give a commitment nobody put a time on.
 *
 * Two days, by the owner's decision (2026-08-18): when the customer showed
 * interest but named no date, tomorrow felt like pressure and produced
 * overdue tasks on perfectly healthy leads. A stated date still wins —
 * this only fills silence.
 */
export const DEFAULT_COMMITMENT_WINDOW_HOURS = 48

/**
 * `\b` is defined on [A-Za-z0-9_], so it never matches beside a Cyrillic or a
 * dotted-i letter: `/\bзавтра\b/` does not match "завтра в 10", and neither
 * did any other Russian phrasing. Every commitment agreed in Russian was
 * therefore losing its time and silently getting our 24-hour default. These
 * lookarounds are the same idea written for the alphabets the customers
 * actually speak.
 */
const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])"
const EDGE_AFTER = "(?![\\p{L}\\p{N}])"
const word = (body: string) => new RegExp(`${EDGE_BEFORE}(?:${body})${EDGE_AFTER}`, "iu")

const CLOCK = /(?:^|\D)([01]?\d|2[0-3])[:.]([0-5]\d)(?:\D|$)/
const TODAY_WORDS = word("bu\\s*g[üu]n|сегодня|today|tonight")
const TOMORROW_WORDS = word("sabah|завтра|tomorrow")
const HOUR_WORDS = new RegExp(`${EDGE_BEFORE}(?:saat|в|at)\\s*([01]?\\d|2[0-3])(?:[:.]([0-5]\\d))?${EDGE_AFTER}`, "iu")

/**
 * "In an hour" is the most common thing a customer actually says, and it was
 * the one shape that fell through to the default: three of the five real
 * promises recorded on production read "bir saat sonra". A relative offset is
 * as exact as a clock — more so, since nobody has to agree on whose clock.
 */
/**
 * "In an hour" is the most common thing a customer actually says, and it was
 * the one shape that fell through to the default: three of the five real
 * promises recorded on production read "bir saat sonra".
 *
 * A MARKER is required — «через», "sonra", "in" — never the bare unit, because
 * Russian uses the same noun for both readings: «в 10 часов» is AT ten
 * o'clock, «через 10 часов» is IN ten hours. Matching "часов" alone would turn
 * a morning appointment into a deadline ten hours after the call.
 */
const RELATIVE_FORMS = [
  // «через час», «через 30 минут», «через полтора часа» (the count is optional)
  /через\s*(\d{1,3})?\s*(час|часа|часов|минут|минуты|минуту)/iu,
  // "bir saat sonra", "30 dəqiqədən sonra", "saatdan sonra"
  /(?:(\d{1,3})|bir)?\s*(saat|dəqiqə)\p{L}*\s*sonra/iu,
  // "in an hour", "in 20 minutes"
  /\bin\s*(?:an?\s*)?(\d{1,3})?\s*(hour|minute)s?\b/iu,
]

function relativeMinutes(phrase: string): number | null {
  for (const form of RELATIVE_FORMS) {
    const match = form.exec(phrase)
    if (!match) continue
    const count = match[1] ? Number(match[1]) : 1
    const unit = match[2].toLowerCase()
    const minutes = /d[əe]qiq|минут|minute/.test(unit) ? count : count * 60
    // Anything past three days is a phrase we have misread, not a commitment.
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 72 * 60) return minutes
  }
  return null
}

/**
 * A named part of the day is a real answer — "tomorrow morning" is not vague —
 * but it is not a clock, and pretending it is would file the customer as
 * having promised a minute they never said.
 */
const DAYPART = [
  { re: word("səhər|s[əe]h[əe]r|утром|morning|g[üu]n[üu]n\\s*birinci\\s*yar[ıi]s[ıi]nda"), hour: 10 },
  { re: word("nahar|günorta|днём|днем|afternoon"), hour: 14 },
  { re: word("axşam|вечером|evening|tonight"), hour: 18 },
]

/**
 * A date from the phrase the analyser heard — only when the phrase is not open
 * to interpretation.
 *
 * Deliberately narrow. "By the end of the week", "next week", "after the
 * holidays" all fall through to the default: a machine's reading of a vague
 * phrase must never be the thing a person is judged late against.
 */
export function resolveCommitmentDue(
  hint: string | null | undefined,
  from: Date,
  timeZone = "UTC",
  /** The tenant's window for a promise with no date on it. */
  windowHours = DEFAULT_COMMITMENT_WINDOW_HOURS,
): CommitmentDue {
  const fallback: CommitmentDue = {
    dueDate: new Date(from.getTime() + windowHours * 3600_000),
    precision: "default",
    statedByCustomer: false,
  }
  const phrase = (hint ?? "").trim()
  if (!phrase) return fallback

  // "In an hour" needs no calendar and no timezone: it is measured from the
  // call that just ended.
  const minutesAway = relativeMinutes(phrase)
  if (minutesAway !== null) {
    return {
      dueDate: new Date(from.getTime() + minutesAway * 60_000),
      precision: "exact",
      statedByCustomer: true,
    }
  }

  const clock = CLOCK.exec(phrase) ?? HOUR_WORDS.exec(phrase)
  const tomorrow = TOMORROW_WORDS.test(phrase)
  const today = TODAY_WORDS.test(phrase)
  const daypart = DAYPART.find((part) => part.re.test(phrase))
  if (!clock && !tomorrow && !today && !daypart) return fallback

  // "18:00" is the customer's wall clock, not the server's. The box runs UTC
  // and the customers are four hours ahead of it, so doing this arithmetic in
  // server time would file every commitment four hours late — and the first
  // false accusation of lateness is exactly what makes a sales team stop
  // trusting the mechanism.
  const local = new Date(from.getTime() + getOffsetMinutes(timeZone, from) * 60_000)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  let day = local.getUTCDate()
  let hours = daypart?.hour ?? 18
  let minutes = 0
  let precision: CommitmentDue["precision"] = clock ? "exact" : "approximate"

  if (tomorrow) day += 1
  if (clock) {
    const parsedHours = Number(clock[1])
    const parsedMinutes = Number(clock[2] ?? "0")
    if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return fallback
    hours = parsedHours
    minutes = parsedMinutes
    precision = "exact"
  }

  const toUtc = (d: number, h: number, mi: number): Date => {
    const naive = Date.UTC(year, month, d, h, mi, 0, 0)
    // Two passes, the same way org-local midnight is converted elsewhere: the
    // offset at the naive instant can differ from the offset at the real one
    // across a DST boundary.
    const first = new Date(naive - getOffsetMinutes(timeZone, new Date(naive)) * 60_000)
    return new Date(naive - getOffsetMinutes(timeZone, first) * 60_000)
  }

  let due = toUtc(day, hours, minutes)
  if (due.getTime() <= from.getTime()) {
    // A time that has already passed, with no day named, means the next one.
    // If the customer DID name today, we do not quietly promise them tomorrow.
    if (today || (!clock && !daypart)) return fallback
    due = toUtc(day + 1, hours, minutes)
    if (due.getTime() <= from.getTime()) return fallback
  }

  return { dueDate: due, precision, statedByCustomer: true }
}

/** Commitments this company owes, in the order the analyser found them. */
export function ourCommitments(insight: Pick<ConversationInsight, "actionItems"> | null | undefined): ActionItem[] {
  const items = insight?.actionItems ?? []
  return items.filter((item) => {
    if (!item || typeof item.text !== "string") return false
    if (item.text.trim().length < 4) return false
    return item.owner !== "customer"
  })
}

export type CommitmentTaskDraft = {
  title: string
  description: string
  dueDate: Date
  precision: CommitmentDue["precision"]
  statedByCustomer: boolean
  priority: "high" | "medium"
}

const TITLE_LIMIT = 160

/**
 * One task per call, not one per sentence.
 *
 * An analyser that finds four phrasings of the same promise would otherwise
 * produce four tasks, and a salesperson who closes four identical tasks after
 * one call learns to close them all without reading. The first commitment is
 * the task; the rest are carried in the description, where they can be read
 * without being separately accountable.
 */
export function buildCommitmentTask(input: {
  insight: Pick<ConversationInsight, "actionItems" | "summary"> | null | undefined
  callAt: Date
  /** The customer's wall clock, not the server's. */
  timeZone?: string
  /** The tenant's setting for an undated promise. Days, as the operator sees it. */
  dueDays?: number
}): CommitmentTaskDraft | null {
  const commitments = ourCommitments(input.insight)
  if (commitments.length === 0) return null

  const dueDays = input.dueDays ?? DEFAULT_COMMITMENT_WINDOW_HOURS / 24
  const [first, ...rest] = commitments
  const due = resolveCommitmentDue(first.dueDateHint, input.callAt, input.timeZone ?? "UTC", dueDays * 24)
  const lines: string[] = []
  lines.push(first.text.trim())
  if (rest.length > 0) {
    lines.push("", ...rest.map((item) => `• ${item.text.trim()}`))
  }
  lines.push("")
  lines.push(
    due.precision === "exact"
      ? `Müştərinin dediyi vaxt: «${(first.dueDateHint ?? "").trim()}»`
      : due.precision === "approximate"
        // The customer named a day or a part of one and no minute. Saying "the
        // customer asked for 18:00" would put words in their mouth that a
        // lateness report would later hold somebody to.
        ? `Müştəri təxmini vaxt dedi: «${(first.dueDateHint ?? "").trim()}» — dəqiq saatı biz qoyduq.`
        : `Müştəri vaxt demədi — bu bizim standart ${dueDays} günlük müddətimizdir.`,
  )

  return {
    title: first.text.trim().replace(/\s+/g, " ").slice(0, TITLE_LIMIT),
    description: lines.join("\n"),
    dueDate: due.dueDate,
    precision: due.precision,
    statedByCustomer: due.statedByCustomer,
    // Anything the customer said about time is a promise; our own default
    // window is not.
    priority: due.precision === "default" ? "medium" : "high",
  }
}
