/**
 * One Voyage embedding through the gateway: the organization's own Voyage key
 * or the platform's, the daily limit on the platform's, and a journal line with
 * the tokens Voyage counted. Three routes used to carry their own copy of this
 * call, each reading the platform key from the environment.
 *
 * Returns null when Voyage is not available to the organization (no key it
 * may use, or the limit is spent) or did not answer with a vector — each
 * caller has its own fallback.
 */
import { aiKeyOrRefusal, isAiUnavailable, type AiFeature } from "@/lib/ai/gateway"

export const VOYAGE_MODEL = "voyage-3-lite"
const VOYAGE_MAX_CHARS = 8000

export async function voyageEmbedding(orgId: string, text: string, feature: AiFeature): Promise<number[] | null> {
  const access = await aiKeyOrRefusal(orgId, "voyage", feature)
  if (isAiUnavailable(access)) return null
  const input = text.slice(0, VOYAGE_MAX_CHARS)
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.apiKey}` },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: [input] }),
  })
  const data = await response.json().catch(() => null) as {
    data?: Array<{ embedding?: number[] }>
    usage?: { total_tokens?: number }
  } | null
  const vector = data?.data?.[0]?.embedding
  if (!vector) return null
  access.journal({
    model: VOYAGE_MODEL,
    // Voyage counts the tokens; without it, about four characters a token.
    inputTokens: data?.usage?.total_tokens ?? Math.max(1, Math.ceil(input.length / 4)),
  })
  return vector
}
