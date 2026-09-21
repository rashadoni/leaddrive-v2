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
import { buildDemoCallPrompt, demoCallFirstName, isDemoPlacedCall } from "@/lib/demo-center/call-prompt"

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

/** One row per call: which prompt this call was given. */
export const PROMPT_SERVED_EVENT = "voice_runtime_prompt_served"
const PROMPT_SERVED_HASH = "voice_runtime_prompt_served:v1"

/**
 * PBX-only prompt endpoint. It never returns contacts, leads, or credentials.
 *
 * Asked without `callId` it answers exactly as it always has: the
 * organisation's own prompt for every call. Asked with the `callId` the CRM
 * minted for one call, it answers for that call: a call the demo placed gets
 * the demo's approved script (src/lib/demo-center/call-prompt.ts) instead of
 * the organisation's prompt, whose identity belongs to other people's sales
 * calls. Each per-call answer is recorded on the call as a call event, which
 * is also how the demo knows the PBX has started asking per call at all.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
  if (!organizationId) return NextResponse.json({ error: "Voice agent is not configured" }, { status: 503 })
  const callId = request.nextUrl.searchParams.get("callId")?.trim() || null
  // The id is the UUID the CRM minted before originating; anything else is a
  // caller error, not a call to look up.
  if (callId !== null && !/^[0-9a-fA-F-]{36}$/.test(callId)) {
    return NextResponse.json({ error: "callId must be the call's UUID" }, { status: 400 })
  }

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
  const organizationPrompt = composeVoiceAgentInstruction({
    prompt: settings?.voiceAgentPrompt,
    knowledge: settings?.voiceAgentKnowledge,
  })

  if (!callId) {
    return NextResponse.json(
      {
        enabled: Boolean(settings),
        prompt: organizationPrompt,
        technicalVoicePolicyVersion: TECHNICAL_VOICE_POLICY_VERSION,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  const forCall = await runWithTenant(organizationId, async () => {
    const call = await prisma.callLog.findFirst({
      where: { organizationId, providerCallId: callId },
      select: { id: true, leadId: true, consentAudit: true },
    })
    if (!call) return { variant: "default" as const, prompt: organizationPrompt }
    let variant: "default" | "demo" = "default"
    let prompt = organizationPrompt
    if (isDemoPlacedCall(call.consentAudit)) {
      const lead = call.leadId
        ? await prisma.lead.findFirst({ where: { id: call.leadId, organizationId }, select: { contactName: true } })
        : null
      variant = "demo"
      prompt = buildDemoCallPrompt({ firstName: demoCallFirstName(lead?.contactName) })
    }
    // Idempotent per call: a retried fetch for the same call adds nothing.
    await prisma.callEvent.createMany({
      data: [{
        organizationId,
        callLogId: call.id,
        provider: "asterisk",
        providerCallId: callId,
        eventType: PROMPT_SERVED_EVENT,
        eventHash: PROMPT_SERVED_HASH,
        payload: { variant },
      }],
      skipDuplicates: true,
    }).catch((error: unknown) => {
      console.error("[voice-runtime-config] prompt-served event not recorded", {
        errorType: error instanceof Error ? error.name : "unknown",
      })
    })
    return { variant, prompt }
  })

  return NextResponse.json(
    {
      enabled: Boolean(settings),
      prompt: forCall.prompt,
      variant: forCall.variant,
      technicalVoicePolicyVersion: TECHNICAL_VOICE_POLICY_VERSION,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
