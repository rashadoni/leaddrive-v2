import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { selectWhatsAppSettingsChannel } from "@/lib/channels/whatsapp-settings-channel"

/**
 * The channel catalog's «Test mesajı» for a connected WhatsApp number. It used /api/v1/whatsapp/test, which sits
 * in the Omni-channel inbox namespace: since Channels moved to Settings for every tenant (2026-10-26) an admin
 * without Omni-channel saw the button and got a module refusal. Here it is channel configuration like its
 * neighbours — a session admin of any tenant (lib/channels-access), /api/v1/channels → `settings` for the proxy.
 */
const testSchema = z.object({
  to: z.string().min(1, "Phone number is required"),
  channelConfigId: z.string().trim().min(1).optional(),
  // A cold test must use a pre-approved Meta template; `hello_world` (en_US) exists in every new WABA.
  templateName: z.string().default("hello_world"),
  languageCode: z.string().default("en_US"),
})

export async function POST(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate

  return runWithTenant(gate.orgId, async () => {
    const parsed = testSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const selection = await selectWhatsAppSettingsChannel(gate.orgId, parsed.data.channelConfigId)
    if (!selection.id) {
      return NextResponse.json(
        { success: false, error: selection.error },
        { status: selection.error === "whatsapp_channel_required" ? 409 : 404 },
      )
    }

    const result = await sendWhatsAppMessage({
      to: parsed.data.to,
      message: `[template:${parsed.data.templateName}]`,
      templateName: parsed.data.templateName,
      templateLanguage: parsed.data.languageCode,
      organizationId: gate.orgId,
      channelConfigId: selection.id,
    })

    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  })
}
