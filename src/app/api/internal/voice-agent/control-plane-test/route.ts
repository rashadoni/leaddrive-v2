import { timingSafeEqual } from "node:crypto"

import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getVoipProvider } from "@/lib/voip"
import { missingVoipFields, normalizeVoipSettings } from "@/lib/voip/configs"
import { isOutboundVoiceDispatchPaused } from "@/lib/voip/outbound-dispatch-gate"

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
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN || ""
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected, "utf8")
  const right = Buffer.from(received, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * No-call rollout proof for the one configured voice pilot. The Asterisk
 * provider performs an authenticated ARI identity read and a signed GET for a
 * random nonexistent registry UUID. It never originates or cancels a call.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || ""
  if (!organizationId) {
    return NextResponse.json({ error: "Voice control plane is unavailable" }, { status: 503 })
  }
  if (
    !["false", "true"].includes(process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED || "")
    || process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED !== "true"
    || !isOutboundVoiceDispatchPaused(organizationId)
  ) {
    return NextResponse.json({ error: "Voice control plane is not staged" }, { status: 409 })
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
  const candidates = configs
    .map((config) => normalizeVoipSettings(config, organizationId))
    .filter((settings) => settings?.provider === "asterisk")
  if (candidates.length !== 1) {
    return NextResponse.json({ error: "Voice control plane is unavailable" }, { status: 503 })
  }
  const settings = candidates[0]
  if (
    !settings
    || settings.provider !== "asterisk"
    || settings.voiceAttemptRegistryEnabled !== true
    || settings.outboundCallDispatchPaused !== true
    || missingVoipFields(settings).length > 0
  ) {
    return NextResponse.json({ error: "Voice control plane is not staged" }, { status: 409 })
  }

  const result = await getVoipProvider(settings).testConnection()
  if (!result.success) {
    return NextResponse.json({ error: "Voice control plane proof failed" }, { status: 503 })
  }
  return NextResponse.json(
    { success: true, callsPlaced: 0 },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
