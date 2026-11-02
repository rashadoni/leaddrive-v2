import { storeStationRecording } from "@/lib/calls/station-recordings"
import { createStationRecordingHandler } from "@/lib/calls/station-recording-upload"
import { withStationTiming } from "@/lib/station-timing"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** A finished line call's recording from the station (owner, 2026-10-31). */
async function handlePost(request: Request) {
  const host = zeytunLineHost()
  return createStationRecordingHandler({
    token: process.env.FANUM_VOICE_RUNTIME_TOKEN?.trim() || "",
    loadConfig: () => host.loadConfig(),
    loadCall: (config, callId) => host.loadCall(config, callId),
    store: storeStationRecording,
  })(request)
}

export const POST = withStationTiming("call-recording", handlePost)
