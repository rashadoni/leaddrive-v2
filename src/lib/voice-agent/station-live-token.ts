/**
 * An organization's own Gemini key for its phone calls (owner, 2026-11-23:
 * «по умолчанию ставь мой ключ; если клиент говорит „я сам буду платить“ —
 * чтоб была возможность заменять на его»).
 *
 * The conversation of an AI phone call (Gemini Live) is opened by the PBX
 * station, and the station holds one key — the platform's. An organization
 * that entered its own Gemini key in «Настройки → ИИ и расходы» gets its
 * calls' conversation on that key the way the browser voice assistant does:
 * the key never leaves the CRM, and the station is handed a short-lived Live
 * token minted with it, at the start of each call, in the answer to its
 * `session` request. No own key — no token, and the call runs on the
 * station's key exactly as before: that is the default.
 *
 * What stays on the platform's credentials for every organization: the
 * line's speech (Vertex) and its second ear (Speech-to-Text). A token opens
 * Live sessions and nothing else.
 *
 *  - Only a station that says it can use a token gets one (the capability
 *    below, in the caps header). A core installed before this compares the
 *    answer `{enabled: false}` whole, and one more field in it would refuse
 *    the call.
 *  - The token is not locked to a setup: the station sends its own, as it
 *    does on its key. It lives as long as the longest call the station
 *    allows, so a dropped session can be resumed (a resume is not a use) or
 *    opened afresh (a use) to the call's end.
 *  - Nothing here can fail a call. No token for any reason — the key was
 *    refused, Google is slow, the answer is not a session — and the call runs
 *    on the platform's key, journaled as the platform's.
 */
import { timingSafeEqual } from "node:crypto"

import { isAiUnavailable, resolveAiKey } from "@/lib/ai/gateway/access"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { logOperationalFailure } from "@/lib/telemetry/operational-failure"
import { callOrganization } from "@/lib/voip/line-numbers"

/** What a station says, among its capabilities, when it can open Live with a token of the CRM's. */
export const STATION_LIVE_TOKEN_CAPABILITY = "live-token-1"
export const STATION_CAPS_HEADER = "x-voice-agent-caps"

/** The same API version the browser's token is minted and used with (GEMINI_LIVE_API_VERSION). */
export const STATION_TOKEN_API_VERSION = "v1beta"
const MINT_URL = `https://generativelanguage.googleapis.com/${STATION_TOKEN_API_VERSION}/auth_tokens`
/** The station's longest call (MAX_CALL_SECONDS, 15 minutes) and five more. */
export const STATION_TOKEN_LIFETIME_MS = 20 * 60_000
/** One session, and as many fresh ones as the core's recovery may open in a call. A resume is not a use. */
export const STATION_TOKEN_USES = 8
/** The station allows the whole session answer five seconds. */
const MINT_TIMEOUT_MS = 2_500
/** A session request is its action and the call's id; a search, an order or a caller's audio is not read here. */
const SESSION_BODY_MAX_BYTES = 512
/** As Google names a token; the station checks the same shape before putting it in a URL. */
export const STATION_TOKEN_PATTERN = /^auth_tokens\/[A-Za-z0-9._-]{8,400}$/
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Fetch = typeof fetch

/** A Live token of this key, usable for one call's sessions. Throws when Google gives none. */
export async function mintStationLiveToken(apiKey: string, now: Date = new Date(), doFetch: Fetch = fetch): Promise<string> {
  const expires = new Date(now.getTime() + STATION_TOKEN_LIFETIME_MS).toISOString()
  const response = await doFetch(MINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    // No setup and no field mask: the effective setup is the one the station sends.
    body: JSON.stringify({ uses: STATION_TOKEN_USES, expireTime: expires, newSessionExpireTime: expires }),
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`station Live token mint failed (${response.status})`)
  const token = (await response.json() as { name?: unknown }).name
  if (typeof token !== "string" || !STATION_TOKEN_PATTERN.test(token)) throw new Error("station Live token response had no token")
  return token
}

export type StationLiveTokenDependencies = {
  /** The organization the call belongs to, or null when the call is not known. */
  organizationOf: (callId: string) => Promise<string | null>
  /** The organization's own Gemini key, or null when it runs on the platform's. */
  ownKey: (organizationId: string) => Promise<string | null>
  mint: (apiKey: string) => Promise<string>
  now: () => number
}

const defaults: StationLiveTokenDependencies = {
  organizationOf: callOrganization,
  async ownKey(organizationId) {
    try {
      const key = await resolveAiKey(organizationId, "gemini")
      return key.keySource === "tenant" ? key.apiKey : null
    } catch (error) {
      // No key of its own and the platform's switched off for it: nothing to mint with.
      if (isAiUnavailable(error)) return null
      throw error
    }
  },
  mint: (apiKey) => mintStationLiveToken(apiKey),
  now: () => Date.now(),
}

/** A started token: whether the request is a session at all (null until its body is read), and the token when it is. */
export type StationLiveTokenPending = { session: boolean | null; token: Promise<string | null> }

/** A call's token is kept this long: the station asks for the session twice when the call is not yet marked answered. */
const KEEP_MS = 90_000
const KEEP_MAX = 200

export function createStationLiveTokens(runtimeToken: string, dependencies: StationLiveTokenDependencies = defaults) {
  const expected = Buffer.from(runtimeToken)
  const kept = new Map<string, { at: number; token: Promise<string | null> }>()

  function forCall(callId: string): Promise<string | null> {
    const now = dependencies.now()
    for (const [id, entry] of kept) if (now - entry.at >= KEEP_MS) kept.delete(id)
    const known = kept.get(callId)
    if (known) return known.token
    const token = (async () => {
      const organizationId = await dependencies.organizationOf(callId)
      const key = organizationId ? await dependencies.ownKey(organizationId) : null
      return key ? await dependencies.mint(key) : null
    })().catch(() => {
      // The key's owner sees its state in «ИИ и расходы»; the call goes on, on the platform's key.
      logOperationalFailure("voice-station-live-token", "warn")
      return null
    })
    if (kept.size >= KEEP_MAX) kept.delete(kept.keys().next().value as string)
    kept.set(callId, { at: now, token })
    return token
  }

  return {
    /**
     * Starts the token for a station's `session` request, beside the handler
     * that answers it. Null — nothing is started and nothing of the request
     * is read — unless the station named the capability and proved itself,
     * and the request is as small as a session's (every other request of a
     * call — a search, a saved order, a phrase's audio — passes untouched).
     * Call it before the request's body is read: it takes its own copy.
     */
    begin(request: Request): StationLiveTokenPending | null {
      const caps = (request.headers.get(STATION_CAPS_HEADER) ?? "").split(",").map((value) => value.trim())
      if (!caps.includes(STATION_LIVE_TOKEN_CAPABILITY)) return null
      const auth = Buffer.from(request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{32,1024})$/i)?.[1] ?? "")
      if (expected.length < 32 || auth.length !== expected.length || !timingSafeEqual(auth, expected)) return null
      if (request.method !== "POST" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return null
      const declared = request.headers.get("content-length") ?? ""
      if (!/^\d{1,3}$/.test(declared) || Number(declared) < 2 || Number(declared) > SESSION_BODY_MAX_BYTES) return null
      const copy = request.clone()
      const pending: StationLiveTokenPending = { session: null, token: Promise.resolve(null) }
      pending.token = (async () => {
        const body = await readJsonRequestWithinLimit(copy, SESSION_BODY_MAX_BYTES)
        const value = body.ok && body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : null
        pending.session = Boolean(value && value.action === "session" && typeof value.callId === "string" && CALL_ID.test(value.callId))
        return pending.session ? forCall((value as { callId: string }).callId) : null
      })().catch(() => {
        pending.session = false
        return null
      })
      return pending
    },

    /**
     * The handler's answer with the token in it — when it is a session's final
     * answer: the line's or the agent's session, or the plain «not ours» after
     * which the station runs the call the ordinary way. Not «ask again once it
     * is answered», and not a refusal.
     */
    async attach(response: Response, pending: StationLiveTokenPending | null): Promise<Response> {
      // Known not to be a session by the time a handler has answered: nothing of the answer is read.
      if (!pending || pending.session === false || response.status !== 200) return response
      let answer: unknown
      try {
        answer = await response.clone().json()
      } catch {
        return response
      }
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) return response
      const session = answer as Record<string, unknown>
      const final = session.enabled === true || (session.enabled === false && session.status === undefined && session.error === undefined)
      if (!final) return response
      const token = await pending.token
      if (!token) return response
      const headers = new Headers(response.headers)
      headers.delete("content-length")
      return new Response(JSON.stringify({ ...session, liveToken: token }), { status: 200, headers })
    },
  }
}
