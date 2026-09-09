import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { aiCallOwnershipWhere } from "@/lib/calls/access"
import { withRlsAuth } from "@/lib/with-rls"
import { getVoipProvider } from "@/lib/voip"
import { exposeVoipProvider, normalizeVoipSettings, type ExposedVoipProvider } from "@/lib/voip/configs"
import type { CallFinalityResult } from "@/lib/voip/types"

type VoipConfigForEnd = {
  id: string
  configName: string
  phoneNumber: string | null
  apiKey: string | null
  settings: Prisma.JsonValue | null
  isActive: boolean
}

async function settleRegistryNotAccepted(params: {
  id: string
  result: Extract<CallFinalityResult, { state: "not_accepted" }>
}) {
  const endedAt = new Date(params.result.updatedAt)
  const changed = await prisma.callLog.updateMany({
    where: {
      id: params.id,
      providerOutcome: null,
      wasAnswered: false,
      endedAt: null,
    },
    data: {
      status: "canceled",
      providerOutcome: "cancelled",
      wasAnswered: false,
      duration: 0,
      endedAt,
    },
  })
  if (changed.count === 1) return true
  const existing = await prisma.callLog.findUnique({
    where: { id: params.id },
    select: { providerOutcome: true },
  })
  return existing?.providerOutcome === "cancelled"
}

// POST — end an active call via the configured VoIP provider
export const POST = withRlsAuth("voip", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  try {
    const callLog = await prisma.callLog.findFirst({
      where: {
        id,
        organizationId: orgId,
        ...aiCallOwnershipWhere(auth.role || "viewer", auth.userId),
      },
    })
    if (!callLog || !callLog.callSid) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 })
    }
    if (callLog.callMode === "ai") {
      return NextResponse.json(
        { error: "AI calls must be ended by the correlated voice-agent lifecycle" },
        { status: 409 },
      )
    }

    const voipConfigs = await prisma.channelConfig.findMany({
      where: { organizationId: orgId, channelType: "voip", isActive: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        configName: true,
        phoneNumber: true,
        apiKey: true,
        settings: true,
        isActive: true,
      },
    }) as VoipConfigForEnd[]
    if (voipConfigs.length === 0) {
      return NextResponse.json({ error: "VoIP not configured" }, { status: 400 })
    }

    const readyProviders = voipConfigs
      .map(exposeVoipProvider)
      .filter((provider): provider is ExposedVoipProvider => Boolean(provider))
      .filter((provider) => provider.ready)
    const matchingProvider = readyProviders.find((provider) => provider.provider === callLog.provider)
      ?? (readyProviders.length === 1 ? readyProviders[0] : null)
    const voipConfig = matchingProvider ? voipConfigs.find((config) => config.id === matchingProvider.id) : null
    if (!voipConfig) {
      return NextResponse.json({ error: `No active ${callLog.provider} VoIP provider found for this call.` }, { status: 400 })
    }

    const normalizedSettings = normalizeVoipSettings(voipConfig, orgId)
    if (!normalizedSettings) {
      return NextResponse.json({ error: "VoIP provider is not ready" }, { status: 400 })
    }
    const provider = getVoipProvider(normalizedSettings)

    if (
      normalizedSettings.provider === "asterisk"
      && normalizedSettings.voiceAttemptRegistryEnabled === true
    ) {
      if (!provider.cancelAndInspectCallFinality) {
        return NextResponse.json({ error: "PBX cancellation is unavailable" }, { status: 503 })
      }
      const finality = await provider.cancelAndInspectCallFinality(callLog.callSid)
      if (finality.state === "unknown") {
        return NextResponse.json({ error: "PBX cancellation could not be proven" }, { status: 503 })
      }
      if (finality.state === "accepted" || finality.state === "active" || finality.state === "terminal") {
        return NextResponse.json({ success: true, pending: true }, { status: 202 })
      }
      if (!await settleRegistryNotAccepted({ id, result: finality })) {
        return NextResponse.json({ error: "PBX terminal state conflicts with CRM" }, { status: 409 })
      }
      return NextResponse.json({ success: true })
    }

    const result = await provider.endCall(callLog.callSid)

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to end call" }, { status: 500 })
    }

    await prisma.callLog.update({
      where: { id },
      data: { status: "completed", endedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("End call error:", e)
    return NextResponse.json({ error: "Failed to end call" }, { status: 500 })
  }
})
