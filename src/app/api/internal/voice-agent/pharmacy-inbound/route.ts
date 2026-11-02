import { createInboundPilotHandler } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { withStationTiming } from "@/lib/station-timing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Disabled unless a private operator grant is installed. No 1C credentials or
// network refresh in this web process. The normal customer search is separate.
// The host is the process's one (zeytunLineHost): start-up and the refresh
// cron parse its catalog ahead of the calls.
const handler = createInboundPilotHandler(process.env.FANUM_VOICE_RUNTIME_TOKEN ?? "", zeytunLineHost())
export const POST = withStationTiming("pharmacy-inbound", handler)
