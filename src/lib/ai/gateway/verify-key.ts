/**
 * Whether a key the organization typed in opens the provider at all — asked
 * before it is saved. The key goes only to the provider's own address, in a
 * header, never in a URL, and the request costs nothing (a list of models, an
 * empty request) or next to nothing (Voyage has no free call: one embedding
 * of one word, a millionth of a cent).
 */
import type { AiProvider } from "./features"

export type KeyCheck = "ok" | "invalid" | "unreachable"

const CHECK_TIMEOUT_MS = 10_000

type Probe = { url: string; init: RequestInit }

function probe(provider: AiProvider, secret: string): Probe {
  switch (provider) {
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/models?limit=1", init: { method: "GET", headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" } } }
    case "gemini":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", init: { method: "GET", headers: { "x-goog-api-key": secret } } }
    case "openai":
      return { url: "https://api.openai.com/v1/models", init: { method: "GET", headers: { Authorization: `Bearer ${secret}` } } }
    case "voyage":
      return {
        url: "https://api.voyageai.com/v1/embeddings",
        init: { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "voyage-3-lite", input: ["ok"] }) },
      }
    case "google_vision":
      // An empty batch: Vision answers it without reading an image.
      return {
        url: "https://vision.googleapis.com/v1/images:annotate",
        init: { method: "POST", headers: { "x-goog-api-key": secret, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [] }) },
      }
    default:
      throw new Error(`verifyProviderKey: no check for ${provider}`)
  }
}

/** Google answers a bad key with 400 and says so in the body; other 400s are about the request, not the key. */
const GOOGLE_BAD_KEY = /API_KEY_INVALID|API key not valid|API key expired/i

export async function verifyProviderKey(
  provider: AiProvider,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  const { url, init } = probe(provider, secret)
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    // 429: the key is real, only busy right now.
    if (res.ok || res.status === 429) return "ok"
    if (res.status === 401 || res.status === 403) return "invalid"
    if (res.status === 400 && (provider === "gemini" || provider === "google_vision")) {
      const body = await res.text().catch(() => "")
      return GOOGLE_BAD_KEY.test(body) ? "invalid" : "ok"
    }
    return "unreachable"
  } catch {
    return "unreachable"
  }
}
