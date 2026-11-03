/**
 * Whether an organization takes bookings on WhatsApp, and on which number —
 * one key in organizations.settings. Read here, apart from the agent, so the
 * settings screen does not load the model client to show a switch.
 */
export type WhatsAppBookingMode = "off" | "book"

export interface WhatsAppBookingSetting {
  mode: WhatsAppBookingMode
  /** The number that takes bookings; null = every WhatsApp number of the organization. */
  channelConfigId: string | null
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
  }
}
