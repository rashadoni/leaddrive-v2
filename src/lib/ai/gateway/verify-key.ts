/**
 * Whether a key the organization typed in opens the provider at all — asked
 * before it is saved, with a request that costs nothing (the list of models).
 * The key goes only to the provider's own address.
 */
import type { AiProvider } from "./features"

export type KeyCheck = "ok" | "invalid" | "unreachable"

const CHECK_TIMEOUT_MS = 10_000

export async function verifyProviderKey(
  provider: AiProvider,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  if (provider !== "anthropic") throw new Error(`verifyProviderKey: no check for ${provider}`)
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", {
      method: "GET",
      headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    // 429: the key is real, only busy right now.
    if (res.ok || res.status === 429) return "ok"
    if (res.status === 401 || res.status === 403) return "invalid"
    return "unreachable"
  } catch {
    return "unreachable"
  }
}
