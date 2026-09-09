import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { validateWhatsAppCredentials } from "@/lib/whatsapp"

// POST /api/v1/whatsapp/validate
// Hits Meta's GET /{phoneNumberId}?fields=verified_name,display_phone_number
// to confirm the stored credentials actually work. Updates
// ChannelConfig.lastValidatedAt on success.
export const POST = withRls(async (_req, { orgId }) => {
  const result = await validateWhatsAppCredentials(orgId)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
})
