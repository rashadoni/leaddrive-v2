/**
 * Expo Push Service client (server-side).
 *
 * Sends notifications to native devices via Expo's hosted push service
 * (https://exp.host/--/api/v2/push/send) — no auth, batched array of messages.
 * Fire-and-forget at the call sites: a push failure must never affect the
 * business action (earn, birthday, etc.). Receipts are not tracked for the MVP.
 *
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

/** A token is well-formed when it's wrapped as ExponentPushToken[...]. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && /^ExponentPushToken\[.+\]$/.test(token)
}

export interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: "default" | null
}

/**
 * Send a batch of Expo push messages. Silently drops malformed tokens. Never
 * throws on network/HTTP errors — logs and returns (callers fire-and-forget).
 * Returns the count actually dispatched (valid tokens).
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<number> {
  const valid = messages.filter((m) => isExpoPushToken(m.to))
  if (valid.length === 0) return 0
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(valid.map((m) => ({ sound: "default", ...m }))),
    })
    if (!res.ok) {
      console.error(`[expo-push] HTTP ${res.status}`)
    }
  } catch (e) {
    console.error("[expo-push] send failed:", e)
  }
  return valid.length
}
