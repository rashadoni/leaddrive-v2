import { createInboundPilotHandler } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { PHONE_AGENT_CAPS_HEADER } from "@/lib/voice-agent/phone-agent/handler"
import { phoneAgentRoute } from "@/lib/voice-agent/phone-agent/host"
import { withStationTiming } from "@/lib/station-timing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Disabled unless a private operator grant is installed. No 1C credentials or
// network refresh in this web process. The normal customer search is separate.
// The host is the process's one (zeytunLineHost): start-up and the refresh
// cron parse its catalog ahead of the calls.
const handler = createInboundPilotHandler(process.env.FANUM_VOICE_RUNTIME_TOKEN ?? "", zeytunLineHost())

// Owner, 2026-11-22: a call of an organization with «ИИ записывает на приём по
// телефону» takes this same station branch (src/lib/voice-agent/phone-agent).
// The agent looks only at a request from a station that names the capability,
// and only at a call whose channel has the switch and is not the line's own;
// everything else reaches the line's handler as the same request, unread.
const agent = phoneAgentRoute(() => zeytunLineHost().loadConfig())

export const POST = withStationTiming("pharmacy-inbound", async (request: Request) =>
  (request.headers.has(PHONE_AGENT_CAPS_HEADER) ? await agent(request.clone()) : null) ?? handler(request))
