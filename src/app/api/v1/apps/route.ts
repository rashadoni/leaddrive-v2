/**
 * GET /api/v1/apps
 *
 * List the catalog. Returns every public app plus the tenant's
 * installations (so the UI can render install state per tile).
 *
 * Slice 1 reads from the `apps` table directly. Slice 2 adds an
 * admin-side filter (private/beta apps surfaced only to org admins
 * with a feature flag) and an OpenAPI-spec generator from the
 * manifest.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  capabilitySettingsFromTenantSettings,
  resolveTenantCapabilities,
  tenantModulesFromFields,
  type TenantAppInstallationState,
} from "@/lib/tenant-capabilities"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("settings", "read", async (_req, auth) => {
  const apps = await prisma.app.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      version: true,
      summary: true,
      vendor: true,
      category: true,
      iconUrl: true,
      docsUrl: true,
      isFirstParty: true,
      manifest: true,
      createdAt: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
  })

  const installations = await prisma.appInstallation.findMany({
    where: { organizationId: auth.orgId, uninstalledAt: null },
    select: {
      id: true,
      appId: true,
      installedVersion: true,
      config: true,
      status: true,
      installedAt: true,
      updatedAt: true,
    },
  })

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: {
      plan: true,
      addons: true,
      features: true,
      modules: true,
      settings: true,
    },
  })

  type InstallationRow = (typeof installations)[number]
  const installedByAppId: Map<string, InstallationRow> = new Map(
    installations.map((i: InstallationRow) => [i.appId, i])
  )
  type AppRow = (typeof apps)[number]
  const appSlugById: Map<string, string> = new Map(apps.map((app: AppRow) => [app.id, app.slug]))
  const installationsBySlug: Record<string, TenantAppInstallationState> = {}
  for (const installation of installations) {
    const slug = appSlugById.get(installation.appId)
    if (!slug) continue
    installationsBySlug[slug] = {
      status: installation.status,
      config: installation.config as Record<string, unknown>,
    }
  }
  const capabilitySettings = capabilitySettingsFromTenantSettings(org?.settings)
  const capabilities = resolveTenantCapabilities({
    plan: org?.plan ?? "starter",
    role: auth.role,
    addons: org?.addons ?? [],
    modules: tenantModulesFromFields({ features: org?.features, modules: org?.modules }),
    installations: installationsBySlug,
    hidden: capabilitySettings.hidden,
    requested: capabilitySettings.requested,
  })
  const capabilityByAppSlug = new Map<string, (typeof capabilities)[number]>(
    capabilities
      .filter((capability) => capability.definition.appSlug)
      .map((capability) => [capability.definition.appSlug!, capability])
  )

  return NextResponse.json({
    apps: apps.map((a: AppRow) => {
      const capability = capabilityByAppSlug.get(a.slug)
      return {
        ...a,
        installation: installedByAppId.get(a.id) ?? null,
        capability: capability
          ? {
              id: capability.definition.id,
              label: capability.definition.label,
              kind: capability.definition.kind,
              billing: capability.definition.billing,
              status: capability.status,
              reason: capability.reason,
              actions: capability.actions,
              enabled: capability.enabled,
              visibleInMenu: capability.visibleInMenu,
            }
          : null,
      }
    }),
  })
})
