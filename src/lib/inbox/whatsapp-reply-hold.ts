/**
 * On a number somebody answers from their phone, we do not answer first.
 *
 * Our reply goes out inside the webhook request — two to five seconds after the customer's message.
 * A person holding the phone answers in ten to sixty. Meta sends no "a human is typing" signal, so
 * there is no way to win that race by being clever: the only way not to answer twice is not to
 * answer immediately.
 *
 * What takes the turn instead is one worker, on purpose: the booking agent's deferred turn
 * (lib/booking/whatsapp-deferred-turn). It waits out a minute's grace, stands down the moment any
 * outbound row appears — our own send, an operator in the inbox, or the case it exists for, a reply
 * typed in the WhatsApp Business app, which arrives as exactly such a row
 * (lib/inbox/whatsapp-app-echo) — and otherwise offers the customer times.
 *
 * This file first said the minute-by-minute backlog sweep (`runAutonomousInboxAgent`) would take
 * that turn, before the booking agent had a deferred path of its own. Both then had one, and on
 * 2026-11-10 they raced on the owner's own coexistence number: the customer asked for an
 * appointment at 07:55:08, the webhook held, and the sweep answered "share your phone number" at
 * 07:56:33 — eight seconds before the deferred turn was due. The deferred turn then read that
 * outbound as "somebody answered" (its rule 2, which cannot tell our robot from their phone) and
 * stood down for good. So the sweep asks `holdsAutomaticReply` too, at both of its gates, and a
 * held channel has exactly one automatic answerer.
 *
 * What this costs, stated plainly: on a held channel the only automatic reply is the booking
 * agent's. Everything else — the rule bot, the support AI, the ticket-reopen notice — stays silent
 * until a person answers. Silence is recoverable, two conflicting answers to one customer are not.
 *
 * The switch is per channel, so the owner can decide differently for a number where the team never
 * touches the phone: `settings.replyHold`
 *   • unset → `auto`: hold exactly when the number also lives in the WhatsApp Business app;
 *   • `"never"` → answer immediately, as on any other number (the owner's explicit choice);
 *   • `"always"` → never answer automatically on this channel, whatever kind of number it is.
 */
import { isCoexistenceChannel } from "@/lib/whatsapp-number-onboarding"

export type ReplyHoldSetting = "auto" | "never" | "always"

export function readReplyHoldSetting(settings: unknown): ReplyHoldSetting {
  const value = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).replyHold
    : null
  return value === "never" || value === "always" ? value : "auto"
}

/**
 * Is the deferred turn in play on this channel — held now, answerable later?
 *
 * `always` is the one held case that never becomes an answer: the owner said this channel's replies
 * are a person's job, full stop. So the worker that gives the booking agent its turn back a minute
 * later must ask THIS question, not `holdsAutomaticReply`, or it would answer on a channel whose
 * whole point is that we do not (lib/booking/whatsapp-deferred-turn).
 */
export function deferredReplyEnabled(settings: unknown): boolean {
  return holdsAutomaticReply(settings) && readReplyHoldSetting(settings) !== "always"
}

/**
 * Should this channel's automatic replies wait for a human instead of going out now?
 *
 * Read once per inbound message and applied to every automatic sender in the turn — the booking
 * agent, the rule bot, the support AI and the ticket-reopen notice. Leaving one of them out would
 * defeat the whole thing: the customer does not care which of our features answered twice.
 */
export function holdsAutomaticReply(settings: unknown): boolean {
  const setting = readReplyHoldSetting(settings)
  if (setting === "always") return true
  if (setting === "never") return false
  return isCoexistenceChannel(settings)
}
