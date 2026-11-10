import { NextResponse } from "next/server"
import { selectWhatsAppSettingsChannel } from "@/lib/channels/whatsapp-settings-channel"
import { readWhatsAppReadiness } from "@/lib/whatsapp-readiness"
import { withRls } from "@/lib/with-rls"

/**
 * GET /api/v1/whatsapp/readiness?channelConfigId=…
 *
 * What this number can do today and what its owner still has to do — quality rating, 24-hour
 * recipient cap, display-name and account review, approved templates. Read-only: it asks Meta and
 * our own template table, and changes nothing.
 */
export const GET = withRls(async (req, { orgId }) => {
  const channelConfigId = new URL(req.url).searchParams.get("channelConfigId")
  const selection = await selectWhatsAppSettingsChannel(orgId, channelConfigId)
  if (!selection.id) {
    return NextResponse.json(
      { success: false, error: selection.error },
      { status: selection.error === "whatsapp_channel_required" ? 409 : 404 },
    )
  }

  const result = await readWhatsAppReadiness(orgId, selection.id)
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: { channelConfigId: result.channelConfigId, ready: result.ready, items: result.items, facts: result.facts },
  })
})
