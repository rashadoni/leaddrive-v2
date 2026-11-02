import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("campaigns", "read", async (_req, { orgId }) => {
  const channels = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, configName: true, displayName: true }, orderBy: { createdAt: "asc" },
  })
  return NextResponse.json({ success: true, data: channels })
})
