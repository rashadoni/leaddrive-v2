/**
 * Whether an organization takes bookings on WhatsApp, and on which number —
 * one key in organizations.settings. Read here, apart from the agent, so the
 * settings screen does not load the model client to show a switch.
 */
import { OPEN_RULES, readAutonomyRules, type AutonomyRules } from "./whatsapp-rules"

export type WhatsAppBookingMode = "off" | "book"

export interface WhatsAppBookingSetting {
  mode: WhatsAppBookingMode
  /** The number that takes bookings; null = every WhatsApp number of the organization. */
  channelConfigId: string | null
  /**
   * What the agent may book by itself. Everything outside becomes a request
   * the salon confirms, with the time held meanwhile — see whatsapp-rules.ts.
   */
  rules: AutonomyRules
  /**
   * The approved WhatsApp template a reminder goes out as when the client has
   * not written for a day. Without it such a reminder cannot be sent at all.
   */
  reminderTemplate: string | null
  /**
   * The same, for «your visit has moved» and «your visit is off»
   * (whatsapp-change-notice.ts). Meta approves one wording per purpose, so a
   * move and a cancellation are two templates, not one with a variable.
   */
  changeTemplate: string | null
  cancelTemplate: string | null
  /**
   * When the client is reminded before the visit, and whether at all.
   * Two reminders at most, because a meeting carries two marks and a third
   * message before a haircut is spam the salon pays for.
   */
  reminders: ReminderSchedule
  /**
   * The published WhatsApp form this number shows instead of a list of times
   * — Meta's own id, written when the form is published and cleared when it
   * is not. Empty means the list, which is what every number had before and
   * what any number falls back to.
   */
  flowId: string | null
}

/**
 * How long a time offered on WhatsApp stays the client's alone — shown on the
 * settings screen, so it lives here and not in the server-only agent.
 */
export const OFFER_HOLD_MINUTES = 15

/** Key in organizations.settings. */
export const WHATSAPP_BOOKING_SETTING = "bookingWhatsApp"

export function readWhatsAppBookingSetting(settings: unknown): WhatsAppBookingSetting {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[WHATSAPP_BOOKING_SETTING] : null
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  return {
    mode: value.mode === "book" ? "book" : "off",
    channelConfigId: typeof value.channelConfigId === "string" && value.channelConfigId ? value.channelConfigId : null,
    // No rules recorded means no narrowing: the agent books whatever it could
    // book before this screen existed.
    rules: "rules" in value ? readAutonomyRules(value.rules) : OPEN_RULES,
    reminderTemplate: template(value.reminderTemplate),
    changeTemplate: template(value.changeTemplate),
    cancelTemplate: template(value.cancelTemplate),
    // A setting nobody has opened keeps what every organization had before
    // this screen existed: a day before, and two hours before.
    reminders: "reminders" in value ? readReminderSchedule(value.reminders) : DEFAULT_REMINDERS,
    flowId: template(value.flowId),
  }
}

/**
 * When a client hears from the salon before the visit.
 *
 * Both reminders cost money now: since 2026-10-01 Meta charges per delivered
 * message beyond 1,000 service messages a month per number, and a reminder
 * sent outside the 24-hour window is a paid utility template from the first
 * one. So this is not decoration — a salon that wants one reminder instead of
 * two halves that bill, and the hours decide whether the answer still leaves
 * time to sell the slot.
 */
export interface ReminderSchedule {
  /** Hours before the visit for the earlier reminder; null = it is not sent. */
  firstHours: number | null
  /** The later one, always closer to the visit than the first; null = off. */
  secondHours: number | null
}

export const DEFAULT_REMINDERS: ReminderSchedule = { firstHours: 24, secondHours: 2 }
/** An hour is the shortest useful warning; a week is as far ahead as a salon plans. */
export const REMINDER_MIN_HOURS = 1
export const REMINDER_MAX_HOURS = 24 * 7

function hours(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const whole = Math.round(value)
  if (whole < REMINDER_MIN_HOURS) return null
  return Math.min(whole, REMINDER_MAX_HOURS)
}

/**
 * Reads the pair and puts it in order. The two slots are «earlier» and
 * «later», not two independent numbers: a form that sends 2 and 24 means the
 * same schedule as 24 and 2, so they are swapped rather than refused. Equal
 * values are one reminder, and the later one is dropped — two identical
 * messages in the same minute is a bug the client pays for twice.
 *
 * A slot switched off stays switched off, and the other one does NOT move
 * into it: a salon that unticks the first reminder would otherwise watch the
 * screen rearrange itself under its hands, and the meeting would start being
 * marked in the other column.
 */
export function readReminderSchedule(value: unknown): ReminderSchedule {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {}
  let first = hours(raw.firstHours)
  let second = hours(raw.secondHours)
  if (first !== null && second !== null) {
    if (second > first) [first, second] = [second, first]
    if (second === first) second = null
  }
  return { firstHours: first, secondHours: second }
}

function template(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
