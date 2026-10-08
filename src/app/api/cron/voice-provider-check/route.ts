import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { readVoicePilotConfig } from "@/lib/ai/voice/config"
import { geminiLiveModel, usableGeminiLiveModelId } from "@/lib/ai/voice/gemini-live"
import { checkGeminiLiveProvider, providerCheckPassed } from "@/lib/ai/voice/provider-check"

export const dynamic = "force-dynamic"

/**
 * Open a real Gemini Live session with this server's own key and report
 * whether the provider took it.
 *
 *   POST /api/cron/voice-provider-check            the model sessions get now
 *   POST /api/cron/voice-provider-check?turn=1     ...and one tool-first turn
 *   POST /api/cron/voice-provider-check?model=ID   a model nobody uses yet
 *
 * The last form is the point: the next model can be tried against production's
 * key and network before a single user is moved to it, and without the key
 * leaving the host. The answer is always 200 with the verdict in `ok` - a
 * refused setup is a result, not a failure of this route.
 *
 * No tenant data is read and no CRM tool runs: the one tool result is a
 * constant, exactly as in the probe test this shares its code with.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const requested = req.nextUrl.searchParams.get("model")
  if (requested !== null && !usableGeminiLiveModelId(requested)) {
    return NextResponse.json({ error: "Not a usable Live model id" }, { status: 400 })
  }

  const voice = readVoicePilotConfig()
  if (voice.realtimeProvider !== "gemini_live" || !voice.geminiApiKey) {
    // Voice is off on this host. That is a state, not a pass.
    return NextResponse.json({ configured: false, ok: false })
  }

  const current = geminiLiveModel()
  const model = requested === null ? current : geminiLiveModel(requested)
  const check = await checkGeminiLiveProvider({
    apiKey: voice.geminiApiKey,
    model,
    turn: req.nextUrl.searchParams.get("turn") === "1",
  })
  return NextResponse.json(
    {
      configured: true,
      ok: providerCheckPassed(check),
      // Whether this is the model a user's session would open with right now.
      current: model.id === current.id,
      ...check,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
