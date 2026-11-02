import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {
  const data = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, configName: true, displayName: true, phoneNumberId: true },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json({ success: true, data })
})
