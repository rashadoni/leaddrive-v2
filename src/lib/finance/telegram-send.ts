import type { FinanceTelegramTarget } from "@/lib/finance/notification-settings"

const TELEGRAM_API_BASE = "https://api.telegram.org"
const SEND_TIMEOUT_MS = 10_000

export type FinanceTelegramResult =
  | { ok: true }
  | { ok: false; reason: "rejected" | "unreachable"; detail: string }

/**
 * Send one finance notice through an organization's own bot into its own chat.
 *
 * The target is an argument and nothing else is consulted: there is no
 * environment fallback, so a caller without a target has nowhere to send.
 * Never throws — a notice that did not go out must not fail the payment that
 * caused it. The callers await this inside request handlers, hence the timeout.
 */
export async function sendFinanceTelegram(
  target: FinanceTelegramTarget,
  text: string,
): Promise<FinanceTelegramResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${target.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target.chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      let detail = `HTTP ${res.status}`
      try {
        const description = (JSON.parse(body) as { description?: unknown }).description
        if (typeof description === "string" && description) detail = description
      } catch { /* not JSON — the status is all there is */ }
      console.error("[Finance TG] Send failed:", detail)
      return { ok: false, reason: "rejected", detail }
    }
    return { ok: true }
  } catch (e) {
    // The error's name only: the request URL carries the bot token.
    const detail = e instanceof Error ? e.name : "Error"
    console.error("[Finance TG] Error:", detail)
    return { ok: false, reason: "unreachable", detail }
  }
}
