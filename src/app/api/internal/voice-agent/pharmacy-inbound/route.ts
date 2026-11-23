import { createInboundPilotHandler } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { PHONE_AGENT_CAPS_HEADER } from "@/lib/voice-agent/phone-agent/handler"
import { phoneAgentRoute } from "@/lib/voice-agent/phone-agent/host"
import { createStationLiveTokens } from "@/lib/voice-agent/station-live-token"
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

// Owner, 2026-11-23: an organization with its own Gemini key has its calls'
// conversation on that key. The token is minted beside the handlers, not after
// them, and goes into the answer of a session — the line's, the agent's or the
// plain «not ours» — for a station that said it can use one. No own key, an
// older station, any failure: the answer is the handler's, untouched.
const liveTokens = createStationLiveTokens(process.env.FANUM_VOICE_RUNTIME_TOKEN ?? "")

export const POST = withStationTiming("pharmacy-inbound", async (request: Request) => {
  const token = liveTokens.begin(request)
  const answer = (request.headers.has(PHONE_AGENT_CAPS_HEADER) ? await agent(request.clone()) : null) ?? await handler(request)
  return liveTokens.attach(answer, token)
})
