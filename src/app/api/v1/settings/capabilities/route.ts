import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  TENANT_CAPABILITY_CATALOG,
  applyCapabilityEntitlement,
  capabilitySettingsFromTenantSettings,
  mergeCapabilitySettingsIntoTenantSettings,
  resolveTenantCapabilities,
  softDisableCapabilityEntitlement,
  tenantModulesFromFields,
  type TenantAppInstallationState,
  type TenantCapabilityState,
} from "@/lib/tenant-capabilities"
import { withRlsAuth } from "@/lib/with-rls"

const patchSchema = z.object({
  capabilityId: z.string().min(1),
  action: z.enum(["request_access", "hide", "show", "disable", "enable"]),
})

type AppSlugRow = { id: string; slug: string }
type AppInstallationRow = { appId: string; status: string; config: Prisma.JsonValue | null }

type CapabilityResponse = {
  id: string
  label: string
  description: string
  kind: string
  billing: string
  appSlug: string | null
  status: string
  reason: string
  actions: string[]
  enabled: boolean
  visibleInMenu: boolean
}

async function readCapabilityState(orgId: string, role?: string) {
  const appSlugs = TENANT_CAPABILITY_CATALOG
    .map((capability) => capability.appSlug)
    .filter((slug): slug is string => Boolean(slug))

  const [org, apps] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        plan: true,
        addons: true,
        features: true,
        modules: true,
        settings: true,
      },
    }),
    prisma.app.findMany({
      where: { slug: { in: appSlugs } },
      select: { id: true, slug: true },
    }),
  ])

  if (!org) return null

  const appSlugById = new Map<string, string>((apps as AppSlugRow[]).map((app) => [app.id, app.slug]))
  const appIdBySlug = new Map<string, string>((apps as AppSlugRow[]).map((app) => [app.slug, app.id]))
  const installations = await prisma.appInstallation.findMany({
    where: { organizationId: orgId, appId: { in: Array.from(appSlugById.keys()) }, uninstalledAt: null },
    select: {
      appId: true,
      status: true,
      config: true,
    },
  })

  const installationsBySlug: Record<string, TenantAppInstallationState> = {}
  for (const installation of installations as AppInstallationRow[]) {
    const slug = appSlugById.get(installation.appId)
    if (!slug) continue
    installationsBySlug[slug] = {
      status: installation.status,
      config: installation.config as Record<string, unknown>,
    }
  }

  const capabilitySettings = capabilitySettingsFromTenantSettings(org.settings)
  const capabilities = resolveTenantCapabilities({
    plan: org.plan,
    role,
    addons: org.addons,
    modules: tenantModulesFromFields({ features: org.features, modules: org.modules }),
    installations: installationsBySlug,
    hidden: capabilitySettings.hidden,
    requested: capabilitySettings.requested,
  })

  return { org, capabilitySettings, capabilities, appIdBySlug }
}

function serializeCapability(capability: TenantCapabilityState): CapabilityResponse {
  return {
    id: capability.definition.id,
    label: capability.definition.label,
    description: capability.definition.description,
    kind: capability.definition.kind,
    billing: capability.definition.billing,
    appSlug: capability.definition.appSlug ?? null,
    status: capability.status,
    reason: capability.reason,
    actions: capability.actions,
    enabled: capability.enabled,
    visibleInMenu: capability.visibleInMenu,
  }
}

export const GET = withRlsAuth("settings", "read", async (_req: NextRequest, auth) => {
  const state = await readCapabilityState(auth.orgId, auth.role)
  if (!state) return NextResponse.json({ error: "Organization not found" }, { status: 404 })

  return NextResponse.json({
    data: {
      capabilities: state.capabilities.map(serializeCapability),
      settings: state.capabilitySettings,
    },
  })
})

export const PATCH = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const state = await readCapabilityState(auth.orgId, auth.role)
  if (!state) return NextResponse.json({ error: "Organization not found" }, { status: 404 })

  const capability = state.capabilities.find((item) => item.definition.id === parsed.data.capabilityId)
  if (!capability) {
    return NextResponse.json({ error: "Capability not found" }, { status: 404 })
  }

  if (!capability.actions.includes(parsed.data.action)) {
    return NextResponse.json(
      {
        error: "Action is not allowed for this tenant capability state",
        status: capability.status,
      },
      { status: 409 },
    )
  }

  if (parsed.data.action === "disable" || parsed.data.action === "enable") {
    const appSlug = capability.definition.appSlug
    if (appSlug) {
      const appId = state.appIdBySlug.get(appSlug)
      if (!appId) {
        return NextResponse.json({ error: "Marketplace app not found for this capability" }, { status: 404 })
      }

      const existing = await prisma.appInstallation.findUnique({
        where: { organizationId_appId: { organizationId: auth.orgId, appId } },
        select: { id: true, uninstalledAt: true },
      })
      if (!existing || existing.uninstalledAt !== null) {
        return NextResponse.json({ error: "Installation not found" }, { status: 404 })
      }

      await prisma.appInstallation.update({
        where: { id: existing.id },
        data: { status: parsed.data.action === "disable" ? "disabled" : "active" },
        select: { id: true },
      })
    } else {
      if (!capability.definition.directEntitlementManagement) {
        return NextResponse.json(
          { error: "This capability is not safe to change through a direct tenant entitlement." },
          { status: 409 },
        )
      }

      const entitlement = parsed.data.action === "disable"
        ? softDisableCapabilityEntitlement(capability.definition, state.org)
        : applyCapabilityEntitlement(capability.definition, state.org)
      await prisma.organization.update({
        where: { id: auth.orgId },
        data: {
          features: entitlement.features as Prisma.InputJsonValue,
          modules: entitlement.modules as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
    }
  } else {
    const settingsPatch =
      parsed.data.action === "request_access"
        ? { requested: { [capability.definition.id]: true } }
        : { hidden: { [capability.definition.id]: parsed.data.action === "hide" } }

    await prisma.organization.update({
      where: { id: auth.orgId },
      data: {
        settings: mergeCapabilitySettingsIntoTenantSettings(
          state.org.settings,
          settingsPatch,
        ) as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
  }

  const updated = await readCapabilityState(auth.orgId, auth.role)
  return NextResponse.json({
    data: {
      capabilities: (updated?.capabilities ?? []).map(serializeCapability),
      settings: updated?.capabilitySettings ?? {},
    },
  })
})
