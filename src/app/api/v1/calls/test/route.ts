import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getVoipProvider } from "@/lib/voip"
import { exposeVoipProvider, missingVoipFields, normalizeVoipSettings, type ExposedVoipProvider } from "@/lib/voip/configs"
import { withRls } from "@/lib/with-rls"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { isAdmin } from "@/lib/permissions"

type VoipConfigForTest = {
  id: string
  configName: string
  phoneNumber: string | null
  apiKey: string | null
  settings: Prisma.JsonValue | null
  isActive: boolean
}

// POST — test VoIP provider connection
export const POST = withRls(async (req, { orgId, session }) => {
  // Provider probing can reach private infrastructure and may expose readiness
  // metadata. Keep it on the authenticated tenant-admin UI path only.
  if (req.headers.has("authorization")) {
    return NextResponse.json({ error: "Session authentication required" }, { status: 403 })
  }
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.role)) {
    return NextResponse.json({ error: "Admin role required for VoIP connection tests" }, { status: 403 })
  }
  if (session.role !== "superadmin" && !(await orgHasModule(orgId, "voip"))) {
    return moduleDisabledResponse("voip")
  }

  try {
    const body = await req.json().catch(() => ({} as { providerConfigId?: string }))
    const requestedProviderConfigId = typeof body.providerConfigId === "string" ? body.providerConfigId.trim() : ""
    const voipConfigs = await prisma.channelConfig.findMany({
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
    }) as VoipConfigForTest[]
    if (voipConfigs.length === 0) {
      return NextResponse.json({ error: "VoIP not configured. Save your settings first." }, { status: 400 })
    }

    const readyProviders = voipConfigs
      .map(exposeVoipProvider)
      .filter((provider): provider is ExposedVoipProvider => Boolean(provider))
      .filter((provider) => provider.ready)
    const voipConfig = requestedProviderConfigId
      ? voipConfigs.find((config) => config.id === requestedProviderConfigId)
      : readyProviders.length === 1
        ? voipConfigs.find((config) => config.id === readyProviders[0].id)
        : undefined

    if (!voipConfig && readyProviders.length > 1) {
      return NextResponse.json({
        error: "choose_call_provider",
        message: "Choose which VoIP provider to test.",
        providers: readyProviders,
      }, { status: 409 })
    }
    if (!voipConfig) {
      return NextResponse.json({ error: "No ready VoIP provider. Complete Settings → VoIP first." }, { status: 400 })
    }

    const normalizedSettings = normalizeVoipSettings(voipConfig, orgId)
    const missingFields = missingVoipFields(normalizedSettings)
    if (!normalizedSettings || missingFields.length > 0) {
      return NextResponse.json({ error: "VoIP provider is not ready.", missingFields }, { status: 400 })
    }

    const providerName = normalizedSettings.provider
    const provider = getVoipProvider(normalizedSettings)

    const result = await provider.testConnection()

    return NextResponse.json({
      success: result.success,
      message: result.message,
      provider: providerName,
      providerConfigId: voipConfig.id,
    })
  } catch (e) {
    console.error("VoIP test error:", e)
    return NextResponse.json({ error: "Test failed: internal error" }, { status: 500 })
  }
})
