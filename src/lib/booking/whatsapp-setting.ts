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
    flowId: template(value.flowId),
  }
}

function template(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
