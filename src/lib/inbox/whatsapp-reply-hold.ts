/**
 * On a number somebody answers from their phone, we do not answer first.
 *
 * Our reply goes out inside the webhook request — two to five seconds after the customer's message.
 * A person holding the phone answers in ten to sixty. Meta sends no "a human is typing" signal, so
 * there is no way to win that race by being clever: the only way not to answer twice is not to
 * answer immediately.
 *
 * What takes the turn instead is machinery that already exists and already waits:
 * `runAutonomousInboxAgent` runs every minute, takes only conversations whose latest row is an
 * inbound customer message, and skips any the team has since covered — and a reply typed in the
 * WhatsApp Business app arrives as exactly such a covering row (lib/inbox/whatsapp-app-echo). So on
 * a held channel the webhook writes the message down, files the ticket, and stops; if nobody has
 * answered from the phone a minute later, the backlog agent does.
 *
 * What this costs, stated plainly: the booking agent has no deferred path of its own yet, so on a
 * held channel it does not offer times at all. That is the honest trade for this step — silence is
 * recoverable, two conflicting answers to one customer are not — and giving the booking agent its
 * turn back on a timer is the next piece of work.
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
