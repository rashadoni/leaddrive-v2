import { selectWhatsAppSettingsChannel } from "@/lib/channels/whatsapp-settings-channel"
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { validateWhatsAppCredentials } from "@/lib/whatsapp"

// POST /api/v1/whatsapp/validate
// Hits Meta's GET /{phoneNumberId}?fields=verified_name,display_phone_number
// to confirm the stored credentials actually work. Updates
// ChannelConfig.lastValidatedAt on success.
export const POST = withRls(async (req, { orgId }) => {
  const selection = await selectWhatsAppSettingsChannel(orgId, new URL(req.url).searchParams.get("channelConfigId"))
  if (!selection.id) return NextResponse.json({ success: false, error: selection.error }, { status: selection.error === "whatsapp_channel_required" ? 409 : 404 })

  const result = await validateWhatsAppCredentials(orgId, { channelConfigId: selection.id })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
})
