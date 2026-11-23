import { randomUUID } from "node:crypto"

import { PHONE_AGENT_CAPABILITY, PHONE_AGENT_CAPS_HEADER } from "../phone-agent/handler"
import { STATION_LIVE_TOKEN_CAPABILITY } from "../station-live-token"
import type { SessionRehearsal } from "./zeytun-inbound-pilot"

const STATION_ROUTE = "/api/internal/voice-agent/pharmacy-inbound"
/**
 * The station's first request of a call, through this process's own route.
 *
 * rehearseInboundSession runs the line's handler; the route in front of it also
 * asks whose call it is twice more - the phone agent (phone-agent/handler.ts)
 * and the organization's own Gemini key (station-live-token.ts) - and a process
 * that has just started loads the route itself on its first request. So the
 * same request the station sends, for a call nobody made, on loopback: the
 * answer is the line's refusal (403) or «not ours», and nothing is changed.
 * Without the port or the station's token there is nothing to ask.
 */
export async function rehearseStationRoute(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 10_000): Promise<SessionRehearsal | { status: "skipped" }> {
  const port = Number(env.PORT), token = env.FANUM_VOICE_RUNTIME_TOKEN ?? ""
  if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 32) return { status: "skipped" }
  const started = Date.now()
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}${STATION_ROUTE}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
        [PHONE_AGENT_CAPS_HEADER]: `${PHONE_AGENT_CAPABILITY}, ${STATION_LIVE_TOKEN_CAPABILITY}` },
      body: JSON.stringify({ action: "session", callId: randomUUID() }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.arrayBuffer().catch(() => undefined)
    return { status: response.status, ms: Date.now() - started }
  } catch {
    return { status: "failed", ms: Date.now() - started }
  }
}
