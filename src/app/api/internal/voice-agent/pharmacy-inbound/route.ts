import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createInboundPilotHandler } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { createInboundPilotHost } from "@/lib/voice-agent/pharmacy/zeytun-inbound-host"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Disabled unless a private operator grant is installed. No 1C credentials or
// network refresh in this web process. The normal customer search is separate.
const handler = createInboundPilotHandler(process.env.FANUM_VOICE_RUNTIME_TOKEN ?? "", createInboundPilotHost({
  configFile: process.env.ZEYTUN_INBOUND_PILOT_FILE ?? "",
  snapshotDirectory: process.env.ZEYTUN_CACHE_DIR ?? "",
  runtimeOrganizationId: process.env.VOICE_AGENT_ORGANIZATION_ID ?? "",
  database: prisma,
  orders: prisma as unknown as PrismaClient,
}))
export const POST = handler
