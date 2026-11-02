import { timingSafeEqual } from "node:crypto"

import { inboundPilotConfigSchema, isLineGrant } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { isPhoneWave, MAX_RECORDING_BYTES } from "./station-recordings"

type LineCall = { id: string; organizationId: string; channelConfigId: string; providerCallId: string } | null

export type StationRecordingDependencies = {
  token: string
  loadConfig: () => Promise<unknown>
  loadCall: (config: ReturnType<typeof inboundPilotConfigSchema.parse>, callId: string) => Promise<unknown>
  store: (orgId: string, callLogId: string, wave: Uint8Array) => Promise<void>
}

const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const json = (body: unknown, status = 200) => Response.json(body, { status })

function authorized(request: Request, expected: string): boolean {
  const received = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected), right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * The station's recording of a finished Zeytun line call
 * (scripts/pbx/fanum-call-recordings.py). Taken only for a call of the line's
 * own grant, organization and channel; anything else is refused for good
 * (404/403) and the station deletes its copy. 409 asks the station to try
 * again later: the call row or the grant was not readable just now.
 */
export function createStationRecordingHandler(deps: StationRecordingDependencies) {
  return async (request: Request): Promise<Response> => {
    if (!authorized(request, deps.token)) return json({ error: "unauthorized" }, 401)
    const callId = new URL(request.url).searchParams.get("callId")?.toLowerCase() ?? ""
    if (!CALL_ID.test(callId)) return json({ error: "invalid_request" }, 400)
    if (!/^audio\/(?:wav|x-wav|wave)$/iu.test(request.headers.get("content-type") ?? "")) return json({ error: "unsupported_content_type" }, 415)
    const declared = Number(request.headers.get("content-length") ?? "0")
    if (!Number.isFinite(declared) || declared > MAX_RECORDING_BYTES) return json({ error: "too_large" }, 413)
    const wave = new Uint8Array(await request.arrayBuffer())
    if (wave.byteLength > MAX_RECORDING_BYTES) return json({ error: "too_large" }, 413)
    if (!isPhoneWave(wave)) return json({ error: "invalid_recording" }, 400)

    const parsed = inboundPilotConfigSchema.safeParse(await deps.loadConfig().catch(() => null))
    if (!parsed.success) return json({ error: "line_unavailable" }, 409)
    const config = parsed.data
    if (!isLineGrant(config)) return json({ error: "not_recorded_line" }, 403)
    let call: LineCall
    try {
      call = await deps.loadCall(config, callId) as LineCall
    } catch {
      return json({ error: "unavailable" }, 409)
    }
    if (!call || call.organizationId !== config.organizationId || call.channelConfigId !== config.channelConfigId
        || call.providerCallId !== callId) {
      return json({ error: "not_found" }, 404)
    }
    try {
      await deps.store(call.organizationId, call.id, wave)
    } catch {
      return json({ error: "unavailable" }, 503)
    }
    console.log("[zeytun-line] recording", JSON.stringify({ bytes: wave.byteLength }))
    return json({ ok: true })
  }
}
