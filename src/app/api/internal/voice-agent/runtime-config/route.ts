import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { missingVoipFields, normalizeVoipSettings } from "@/lib/voip/configs"
import {
  composeVoiceAgentInstruction,
  TECHNICAL_VOICE_POLICY_VERSION,
} from "@/lib/voice-agent/default-prompt"

export const dynamic = "force-dynamic"

type RuntimeVoipConfig = {
  id: string
  configName: string
  phoneNumber: string | null
  apiKey: string | null
  settings: Prisma.JsonValue | null
  isActive: boolean
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** PBX-only prompt endpoint. It never returns contacts, leads, or credentials. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
  if (!organizationId) return NextResponse.json({ error: "Voice agent is not configured" }, { status: 503 })

  const configs = await runWithTenant(organizationId, () => prisma.channelConfig.findMany({
    where: { organizationId, channelType: "voip", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      configName: true,
      phoneNumber: true,
      apiKey: true,
      settings: true,
      isActive: true,
    },
  })) as RuntimeVoipConfig[]
  const candidates = configs.map((config) => ({
    config,
    settings: (config.settings || {}) as Record<string, unknown>,
  }))

  // Manual outbound calls and their preflight use the newest ready Asterisk
  // config with both kill switches enabled. Prefer that exact class here too,
  // so a newer inbound-only row cannot silently supply a different prompt.
  // The legacy voice-enabled fallback is retained for inbound-only runtimes.
  const manualOutbound = candidates.find(({ config, settings }) => {
    const normalized = normalizeVoipSettings(config)
    return normalized?.provider === "asterisk"
      && missingVoipFields(normalized).length === 0
      && settings.voiceAgentEnabled === true
      && settings.manualLeadAiCallsEnabled === true
      && (settings.voiceAgentMode === "outbound" || settings.voiceAgentMode === "both")
  })
  const fallback = candidates.find(({ settings }) => (
    settings.provider === "asterisk" && settings.voiceAgentEnabled === true
  ))
  const settings = (manualOutbound ?? fallback)?.settings
  const prompt = composeVoiceAgentInstruction({
    prompt: settings?.voiceAgentPrompt,
    knowledge: settings?.voiceAgentKnowledge,
  })

  return NextResponse.json(
    {
      enabled: Boolean(settings),
      prompt,
      technicalVoicePolicyVersion: TECHNICAL_VOICE_POLICY_VERSION,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
