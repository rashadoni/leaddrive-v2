import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { isCoexistenceChannel } from "@/lib/whatsapp-number-onboarding"
import { historyImportStatus } from "@/lib/whatsapp-history-import/status"
import { insideSyncWindow, requestCoexistenceSync } from "@/lib/whatsapp-history-import/request"

/**
 * The import of a coexistence number's contacts and chats (lib/whatsapp-history-import).
 *
 * GET  — where it stands, for the channel's row on the settings screen.
 * POST — ask Meta again for what it refused. Only inside Meta's 24 hours after the number was
 *        connected, and only for a request Meta did not accept: an accepted one is never repeated
 *        («You can only perform this step once»).
 *
 * Admin-only, like the rest of a channel's configuration (lib/channels-access).
 */
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return runWithTenant(gate.orgId, async () => {
    const view = await historyImportStatus(gate.orgId, id)
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(view)
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return runWithTenant(gate.orgId, async () => {
    const view = await historyImportStatus(gate.orgId, id)
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const config = await resolveWhatsAppConfig(gate.orgId, { channelConfigId: id })
    const channel = await prisma.channelConfig.findFirst({
      where: { id, organizationId: gate.orgId, channelType: "whatsapp" },
      select: { settings: true },
    })
    if (!config?.accessToken || !config.phoneNumberId || !channel || !isCoexistenceChannel(channel.settings)) {
      return NextResponse.json({ error: "not_coexistence" }, { status: 409 })
    }
    if (!insideSyncWindow(channel.settings)) {
      return NextResponse.json({ error: "window_closed" }, { status: 409 })
    }
    if (!view.canRetry) return NextResponse.json({ error: "nothing_to_retry" }, { status: 409 })
    await requestCoexistenceSync({
      organizationId: gate.orgId,
      channelConfigId: id,
      phoneNumberId: config.phoneNumberId,
      token: config.accessToken,
    })
    return NextResponse.json(await historyImportStatus(gate.orgId, id))
  })
}
