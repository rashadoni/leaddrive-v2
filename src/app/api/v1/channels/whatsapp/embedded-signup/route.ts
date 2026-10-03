import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import { auditChannelChange } from "@/lib/channels/channel-credential-audit"
import { completeEmbeddedSignup, whatsappPlatformApp } from "@/lib/whatsapp-embedded-signup"

/**
 * WhatsApp Embedded Signup (lib/whatsapp-embedded-signup).
 *
 * GET  — what the browser needs to open Meta's dialog: the app id and the Embedded Signup
 *        configuration id. Both are public identifiers; the app secret never leaves the server.
 *        `configured: false` hides the button.
 * POST — the result of the dialog ({ code, wabaId, phoneNumberId, businessId? }); finishes the
 *        onboarding server-side and saves the channel in the caller's workspace.
 *
 * Admin-only, like every other channel credential change (lib/channels-access).
 */
export async function GET(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  return runWithTenant(gate.orgId, async () => {
    const app = whatsappPlatformApp()
    return NextResponse.json(app ? { configured: true, appId: app.appId, configId: app.configId } : { configured: false })
  })
}

const bodySchema = z.object({
  code: z.string().min(1).max(4096),
  wabaId: z.string().regex(/^\d{5,25}$/),
  phoneNumberId: z.string().regex(/^\d{5,25}$/),
  businessId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, step: "exchange", error: "Meta did not return a complete signup." }, { status: 400 })
  }

  return runWithTenant(gate.orgId, async () => {
    const result = await completeEmbeddedSignup({
      organizationId: gate.orgId,
      code: parsed.data.code,
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      businessId: parsed.data.businessId ?? null,
      createdBy: gate.userId,
    })
    if (!result.ok) {
      const status = result.step === "config" ? 503 : result.step === "conflict" ? 409 : 400
      return NextResponse.json(result, { status })
    }
    await auditChannelChange({
      req,
      orgId: gate.orgId,
      userId: gate.userId,
      action: result.created ? "create" : "update",
      channelId: result.channelId,
      channelType: "whatsapp",
      configName: result.verifiedName || result.displayPhoneNumber,
      credentialFields: ["accessToken"],
    })
    return NextResponse.json(result)
  })
}
