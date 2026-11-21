import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { logAudit, prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import {
  WHATSAPP_INBOUND_PURPOSE_KEY,
  isWhatsAppInboundPurpose,
  whatsappInboundPurpose,
} from "@/lib/channels/whatsapp-inbound-purpose"

/**
 * What a WhatsApp number is for: «Переписка» (the Omni-Channel inbox only) or «Поддержка» (every
 * message becomes a Service Desk ticket) — lib/channels/whatsapp-inbound-purpose.
 *
 * GET — the number's purpose, for its row on the channels screen.
 * PUT — `{ purpose }`. The one writer of `settings.inboundPurpose`: the channel form cannot write
 *       or erase it (lib/channels/server-owned-settings).
 *
 * Admin-only, like the rest of a channel's configuration (lib/channels-access). Switching a number
 * to «Переписка» touches no existing ticket: the ones already open stay as they are, they only
 * stop receiving this number's messages.
 */
type Params = { params: Promise<{ id: string }> }

async function findNumber(orgId: string, id: string) {
  return prisma.channelConfig.findFirst({
    where: { id, organizationId: orgId, channelType: "whatsapp" },
    select: { id: true, configName: true, settings: true },
  })
}

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return runWithTenant(gate.orgId, async () => {
    const channel = await findNumber(gate.orgId, id)
    if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ purpose: whatsappInboundPurpose(channel.settings) })
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { purpose?: unknown } | null
  const purpose = body?.purpose
  if (!isWhatsAppInboundPurpose(purpose)) {
    return NextResponse.json({ error: "purpose must be \"conversations\" or \"support\"" }, { status: 400 })
  }
  return runWithTenant(gate.orgId, async () => {
    const channel = await findNumber(gate.orgId, id)
    if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const previous = whatsappInboundPurpose(channel.settings)
    const current = channel.settings && typeof channel.settings === "object" && !Array.isArray(channel.settings)
      ? (channel.settings as Record<string, unknown>)
      : {}
    // Written even when it equals what the number already does: a number with nothing stored is
    // «Поддержка» only by default, and a person who looked and pressed Save has now chosen it.
    await prisma.channelConfig.update({
      where: { id: channel.id },
      data: { settings: { ...current, [WHATSAPP_INBOUND_PURPOSE_KEY]: purpose } },
    })
    if (previous !== purpose) {
      await logAudit(gate.orgId, "whatsapp_inbound_purpose_updated", "channelConfig", channel.id, channel.configName, {
        userId: gate.userId,
        oldValue: { purpose: previous },
        newValue: { purpose },
      })
    }
    return NextResponse.json({ purpose })
  })
}
