import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import { APP_URL } from "@/lib/domains"
import {
  THREECX_CRM_TEMPLATE_NAME,
  buildThreeCxCrmTemplate,
} from "@/lib/voip/threecx-crm"

/**
 * GET /api/v1/calls/threecx/template — download the server-side 3CX CRM template.
 *
 * The owner uploads the returned XML in the PBX under
 * Admin → Integrations → CRM → Server side. It wires two scenarios back to this
 * CRM: caller lookup (contact name on ringing) and ReportCall (call journaling).
 *
 * The org id and webhook secret are baked into the file, so this is an
 * authenticated, tenant-scoped download — never a public URL.
 */
export async function GET(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId } = gate

  return runWithTenant(orgId, async () => {
    const config = await prisma.channelConfig.findFirst({
      where: { organizationId: orgId, channelType: "voip" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { settings: true },
    })

    const settings = (config?.settings ?? null) as
      | { provider?: string; webhookSecret?: string }
      | null

    if (!config) {
      return NextResponse.json(
        { error: "VoIP channel is not configured yet. Save the 3CX settings first." },
        { status: 400 },
      )
    }
    if (settings?.provider && settings.provider !== "threecx") {
      return NextResponse.json(
        { error: `The 3CX template applies to the 3CX provider, current provider is "${settings.provider}".` },
        { status: 400 },
      )
    }
    const secret = typeof settings?.webhookSecret === "string" ? settings.webhookSecret.trim() : ""
    if (!secret) {
      return NextResponse.json(
        { error: "Generate an integration secret in Settings → Telephony before downloading the template." },
        { status: 400 },
      )
    }

    const xml = buildThreeCxCrmTemplate({
      appUrl: APP_URL,
      organizationId: orgId,
      secret,
    })

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${THREECX_CRM_TEMPLATE_NAME}.xml"`,
        // Contains the tenant's integration secret — never cache it anywhere.
        "Cache-Control": "no-store, max-age=0",
      },
    })
  })
}
