import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { channelAccountOf, INBOX_ACCOUNT_CHANNEL_TYPES } from "@/lib/inbox/conversation-channel"

/**
 * The organization's live numbers and pages, for the «which conversations does this person see»
 * checkboxes on the user card (lib/inbox/channel-access). Only who may change users gets it, and
 * only the label columns — never a token or a secret.
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!checkPermission(auth.role, "settings", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const rows = await prisma.channelConfig.findMany({
    where: { organizationId: auth.orgId, isActive: true, channelType: { in: [...INBOX_ACCOUNT_CHANNEL_TYPES] } },
    select: { id: true, channelType: true, configName: true, displayName: true, phoneNumber: true, settings: true },
    orderBy: [{ channelType: "asc" }, { createdAt: "asc" }],
  })
  return NextResponse.json({ success: true, data: rows.map(channelAccountOf) })
})
