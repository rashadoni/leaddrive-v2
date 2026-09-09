import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import { APP_URL } from "@/lib/domains"
import { threeCxJournalUrl, threeCxLookupUrl } from "@/lib/voip/threecx-crm"

/**
 * GET /api/v1/calls/threecx/setup — the two URLs the 3CX CRM template calls.
 *
 * The Settings → Telephony screen shows these so the owner can paste them into a
 * hand-edited template or verify them from the PBX. They embed the tenant's
 * integration secret, so this is authenticated and never cached.
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

    const settings = (config?.settings ?? null) as { webhookSecret?: string } | null
    const secret = typeof settings?.webhookSecret === "string" ? settings.webhookSecret.trim() : ""

    if (!secret) {
      return NextResponse.json(
        { success: true, data: { ready: false, lookupUrl: null, journalUrl: null } },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      )
    }

    const opts = { appUrl: APP_URL, organizationId: orgId, secret }
    return NextResponse.json(
      {
        success: true,
        data: {
          ready: true,
          lookupUrl: threeCxLookupUrl(opts),
          journalUrl: threeCxJournalUrl(opts),
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    )
  })
}
