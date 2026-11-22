import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { logAudit } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { checkWhatsAppDelivery, resubscribeWhatsAppDelivery } from "@/lib/whatsapp-delivery-check"

/**
 * «Проверить приём сообщений» for one WhatsApp number (lib/whatsapp-delivery-check).
 *
 * GET  — asks Meta whether the number is connected to Cloud API, whether an app is subscribed to
 *        its account's webhooks and where Meta sends them, and says what that means.
 * POST — subscribes the app again. Only when the check found that this is what is wrong; the
 *        answer is the check run again afterwards.
 *
 * Admin-only, like the rest of a channel's configuration (lib/channels-access). Nothing of the
 * token leaves the server: the answer carries statuses, app names and callback HOSTS.
 */
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return runWithTenant(gate.orgId, async () => {
    const view = await checkWhatsAppDelivery(gate.orgId, id)
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(view)
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return runWithTenant(gate.orgId, async () => {
    const result = await resubscribeWhatsAppDelivery(gate.orgId, id)
    if (!result.ok) {
      if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
      const status = result.reason === "meta_refused" ? 502 : 409
      return NextResponse.json({ error: result.reason, message: result.error ?? null, view: result.view ?? null }, { status })
    }
    await logAudit(gate.orgId, "whatsapp_webhook_resubscribed", "channelConfig", id, undefined, {
      userId: gate.userId,
      newValue: { verdict: result.view.verdict, subscribed: result.view.subscribed },
    })
    return NextResponse.json(result.view)
  })
}
