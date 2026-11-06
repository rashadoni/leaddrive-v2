import { NextRequest, NextResponse } from "next/server"
import type { PrismaClient } from "@prisma/client"

import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { getVoipProvider } from "@/lib/voip/factory"
import { normalizeVoipSettings, voipFromNumber } from "@/lib/voip/configs"
import { inboundPilotConfigSchema, isLineGrant } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { placeWaitlistCallback } from "@/lib/voice-agent/pharmacy/zeytun-waitlist-callback"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Owner's queue task 10: the line's AI calls a pharmacy back about products it waited for
 * (zeytun-waitlist-callback.ts). Every five minutes; at most one call; nothing unless the
 * order organization switched it on, inside its voice calling hours.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const parsed = inboundPilotConfigSchema.safeParse(await zeytunLineHost().loadConfig().catch(() => null))
  if (!parsed.success || !isLineGrant(parsed.data) || !parsed.data.orderOrganizationId) return NextResponse.json({ status: "not_configured" })
  const grant = { id: parsed.data.id, organizationId: parsed.data.organizationId, channelConfigId: parsed.data.channelConfigId,
    orderOrganizationId: parsed.data.orderOrganizationId }
  const result = await placeWaitlistCallback({
    db: prisma as unknown as PrismaClient, grant,
    dial: async ({ channel, toNumber, correlationId }) => {
      const settings = normalizeVoipSettings({ ...channel, isActive: true } as Parameters<typeof normalizeVoipSettings>[0], grant.organizationId)
      if (!settings) return { success: false, error: "voip_settings" }
      const fromNumber = voipFromNumber(settings)
      const placed = await getVoipProvider(settings).initiateCall({ toNumber, fromNumber, correlationId, voiceAgent: true })
      return { success: placed.success, error: placed.success ? undefined : "provider_refused" }
    },
  }).catch((error: unknown) => {
    console.error("[zeytun-line] callback failed:", error instanceof Error ? error.name : typeof error)
    return { status: "failed" as const }
  })
  if (result.status === "placed" || result.status === "failed" || result.status === "no_phone") {
    console.log("[zeytun-line] callback", JSON.stringify(result))
  }
  return NextResponse.json(result)
}
