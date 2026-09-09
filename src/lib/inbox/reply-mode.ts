/**
 * Per-channel reply-mode gate for AI auto-reply. Two channel families:
 *   • opt-in (default) — TikTok/FB/IG/Telegram/VK: AI runs ONLY when the channel is explicitly
 *     set to "ai" (matrix). Unset/anything-else → no AI (agent answers).
 *   • default-on — WhatsApp (Da Vinci): AI is live by default on every existing tenant channel,
 *     so it runs UNLESS the channel is explicitly set to "agent" (the off-switch). This avoids
 *     silently disabling AI for the live WhatsApp tenants when they have no replyMode stored.
 *
 * `replyMode` is the RAW stored value (no "agent" coercion) so the default-on case can tell
 * "unset" from "explicitly agent".
 */
export function aiReplyEnabled(replyMode: string | null | undefined, defaultOn = false): boolean {
  return defaultOn ? replyMode !== "agent" : replyMode === "ai"
}
