/**
 * Instagram and Messenger take a reply from the CRM only within 24 hours of the customer's last
 * message (7 days for a person's reply once Meta approves the app's «Human Agent» feature — see
 * lib/social/meta-dm-attachment). The Instagram app on the phone has no such limit, so to the
 * operator it looked like the CRM was broken: Zeytun 2026-11-16, ten tries in nine minutes, 24–35
 * hours after the customer wrote, at Meta's raw «Сообщение отправлено за пределами допустимого
 * окна» on an Azerbaijani screen.
 *
 * The server answers such a refusal with a code; this turns it into what happened and what to do,
 * in the screen's language. Client-safe: the inbox page imports it.
 */

/** The error code `sendConversationReply` returns when Meta refused because the window had closed. */
export const META_OUTSIDE_WINDOW = "meta_outside_window"

const HOUR_MS = 60 * 60 * 1000
/** Past this even a person's tagged reply is refused: the message names days, not the 24 hours. */
const HUMAN_AGENT_WINDOW_HOURS = 7 * 24

const APP_BY_CHANNEL: Record<string, string> = { instagram: "Instagram", facebook: "Messenger" }

type WindowMessage = { direction?: string | null; channelType?: string | null; createdAt?: string | Date | null; metadata?: unknown }

/** An Instagram comment row (lib/inbox/instagram-comment-ingest): a comment opens no Direct window. */
function isCommentRow(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
  const comment = (metadata as Record<string, unknown>).igComment
  return !!comment && typeof comment === "object"
}

/** A translation key in the `inboxV2` namespace and its values. */
export type MetaWindowNotice = { key: string; values: Record<string, string | number> }

/** Whole hours since the customer's last message on this channel, or null when none is loaded. */
export function hoursSinceCustomerWrote(messages: readonly WindowMessage[], channel: string, now: number = Date.now()): number | null {
  let last = -Infinity
  for (const m of messages) {
    if (m.direction !== "inbound" || m.channelType !== channel || !m.createdAt || isCommentRow(m.metadata)) continue
    const at = new Date(m.createdAt).getTime()
    if (Number.isFinite(at) && at > last) last = at
  }
  if (!Number.isFinite(last)) return null
  return Math.max(0, Math.floor((now - last) / HOUR_MS))
}

/** What the composer says when the send came back `META_OUTSIDE_WINDOW`. */
export function metaWindowNotice(messages: readonly WindowMessage[], channel: string, now: number = Date.now()): MetaWindowNotice {
  const app = APP_BY_CHANNEL[channel] ?? "Instagram"
  const hours = hoursSinceCustomerWrote(messages, channel, now)
  if (hours === null || hours < 24) return { key: "sendMetaWindowClosed", values: { app } }
  if (hours >= HUMAN_AGENT_WINDOW_HOURS) {
    return { key: "sendMetaWindowClosedDays", values: { app, days: Math.floor(hours / 24) } }
  }
  return { key: "sendMetaWindowClosedHours", values: { app, hours } }
}
