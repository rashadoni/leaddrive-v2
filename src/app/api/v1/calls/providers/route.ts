import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { exposeVoipProvider, type ExposedVoipProvider } from "@/lib/voip/configs"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const configs = await prisma.channelConfig.findMany({
      where: { organizationId: orgId, channelType: "voip", isActive: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        configName: true,
        phoneNumber: true,
        apiKey: true,
        settings: true,
        isActive: true,
      },
    })

    const providers = configs
      .map(exposeVoipProvider)
      .filter((provider: ExposedVoipProvider | null): provider is ExposedVoipProvider => Boolean(provider))
    return NextResponse.json({
      success: true,
      data: providers,
    })
  } catch (e) {
    console.error("Call providers error:", e)
    return NextResponse.json({ error: "Failed to load call providers" }, { status: 500 })
  }
})
