import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { AppInstallError, installTenantApp, type InstallTenantAppResult } from "@/lib/apps/install-executor"
import { hasModule } from "@/lib/modules"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import {
  ensureWorkforceDefaultProfile,
  type WorkforceDefaultProfileProvisioningResult,
} from "@/lib/workforce/default-configuration-provisioning"
import {
  TENANT_CAPABILITY_CATALOG,
  ADVISOR_SUITE_ADDONS,
  ADVISOR_SUITE_MODULE_IDS,
  applyAdvisorSuiteActivation,
  applyCapabilityEntitlement,
  capabilitySettingsFromTenantSettings,
  entitlementKeysForCapability,
  getTenantCapabilityDefinition,
  mergeCapabilitySettingsIntoTenantSettings,
  removeCapabilityEntitlement,
  resolveTenantCapabilities,
  tenantModulesFromFields,
  type TenantAppInstallationState,
  type TenantCapabilityState,
} from "@/lib/tenant-capabilities"
import { runWithRlsBypass } from "@/lib/rls-context"

const patchSchema = z.object({
  capabilityId: z.string().min(1).optional(),
  action: z.enum(["approve", "disable", "reject_request", "enable_advisor_suite"]),
}).superRefine((value, ctx) => {
  if (value.action !== "enable_advisor_suite" && !value.capabilityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilityId"],
      message: "capabilityId is required",
    })
  }
})

type AppSlugRow = { id: string; slug: string }
type AppInstallationRow = { appId: string; status: string; config: Prisma.JsonValue | null }

async function readTenantCapabilityState(tenantId: string, role = "superadmin") {
  const appSlugs = TENANT_CAPABILITY_CATALOG
    .map((capability) => capability.appSlug)
    .filter((slug): slug is string => Boolean(slug))

  const [tenant, apps] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
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

  if (!tenant) return null

  const appSlugById = new Map<string, string>((apps as AppSlugRow[]).map((app) => [app.id, app.slug]))
  const installations = await prisma.appInstallation.findMany({
    where: { organizationId: tenantId, appId: { in: Array.from(appSlugById.keys()) }, uninstalledAt: null },
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

  const capabilitySettings = capabilitySettingsFromTenantSettings(tenant.settings)
  const modules = tenantModulesFromFields({ features: tenant.features, modules: tenant.modules })
  const capabilities = resolveTenantCapabilities({
    plan: tenant.plan,
    role,
    addons: tenant.addons,
    modules,
    installations: installationsBySlug,
    hidden: capabilitySettings.hidden,
    requested: capabilitySettings.requested,
  })

  return { tenant, capabilitySettings, capabilities, modules }
}

function serializeCapability(capability: TenantCapabilityState) {
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
    entitlementKeys: entitlementKeysForCapability(capability.definition),
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  return runWithRlsBypass(async () => {
    const state = await readTenantCapabilityState(id, auth.role)
    if (!state) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })

    return NextResponse.json({
      data: {
        tenant: {
          id: state.tenant.id,
          name: state.tenant.name,
          slug: state.tenant.slug,
          plan: state.tenant.plan,
          addons: state.tenant.addons,
        },
        capabilities: state.capabilities.map(serializeCapability),
        settings: state.capabilitySettings,
      },
    })
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  return runWithRlsBypass(async () => {
    const state = await readTenantCapabilityState(id, auth.role)
    if (!state) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })

    if (parsed.data.action === "enable_advisor_suite") {
      const suite = applyAdvisorSuiteActivation({
        features: state.tenant.features,
        modules: state.tenant.modules,
        addons: state.tenant.addons,
        settings: state.tenant.settings,
      })

      await prisma.organization.update({
        where: { id },
        data: {
          addons: suite.addons,
          features: suite.features as Prisma.InputJsonValue,
          modules: suite.modules as Prisma.InputJsonValue,
          settings: suite.settings as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      await prisma.auditLog.create({
        data: {
          organizationId: id,
          userId: auth.userId,
          action: "enable_advisor_suite",
          entityType: "tenant_capability",
          entityId: `${id}:advisor-suite`,
          entityName: state.tenant.name,
          oldValue: {
            addons: state.tenant.addons,
            features: state.tenant.features,
            modules: state.tenant.modules,
            settings: state.tenant.settings,
          },
          newValue: {
            addons: suite.addons,
            modules: ADVISOR_SUITE_MODULE_IDS,
            advisorAddons: ADVISOR_SUITE_ADDONS,
            settings: suite.settings,
          },
        },
      })

      const updated = await readTenantCapabilityState(id, auth.role)
      return NextResponse.json({
        data: {
          capabilities: (updated?.capabilities ?? []).map(serializeCapability),
          settings: updated?.capabilitySettings ?? {},
        },
      })
    }

    const definition = getTenantCapabilityDefinition(parsed.data.capabilityId!)
    if (!definition) return NextResponse.json({ error: "Capability not found" }, { status: 404 })

    const entitlementKeys = entitlementKeysForCapability(definition)

    if (parsed.data.action === "reject_request") {
      const settings = mergeCapabilitySettingsIntoTenantSettings(state.tenant.settings, {
        requested: { [definition.id]: false },
      })
      await prisma.organization.update({
        where: { id },
        data: { settings: settings as Prisma.InputJsonValue },
        select: { id: true },
      })
      logAudit(auth.orgId, "reject_request", "tenant_capability", `${id}:${definition.id}`, state.tenant.name, {
        oldValue: { requested: state.capabilitySettings.requested?.[definition.id] === true },
        newValue: { requested: false },
      })
    } else if (parsed.data.action === "disable") {
      if (definition.disableMode !== "soft_disable" || definition.appSlug || entitlementKeys.length === 0) {
        return NextResponse.json(
          {
            error: "This capability cannot be disabled through its entitlement record.",
            capabilityId: definition.id,
          },
          { status: 409 },
        )
      }

      const entitlement = removeCapabilityEntitlement(definition, {
        features: state.tenant.features,
        modules: state.tenant.modules,
      })
      const settings = mergeCapabilitySettingsIntoTenantSettings(state.tenant.settings, {
        requested: { [definition.id]: false },
      })
      await prisma.organization.update({
        where: { id },
        data: {
          features: entitlement.features as Prisma.InputJsonValue,
          modules: entitlement.modules as Prisma.InputJsonValue,
          settings: settings as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
      logAudit(auth.orgId, "disable", "tenant_capability", `${id}:${definition.id}`, state.tenant.name, {
        oldValue: {
          enabled: state.capabilities.some((capability) => capability.definition.id === definition.id && capability.enabled),
          features: state.tenant.features,
          modules: state.tenant.modules,
        },
        newValue: {
          enabled: false,
          entitlementKeys,
          features: entitlement.features,
          modules: entitlement.modules,
        },
      })
    } else {
      if (entitlementKeys.length === 0 && !definition.appSlug) {
        return NextResponse.json(
          {
            error: "This capability has no entitlement or marketplace app binding.",
            capabilityId: definition.id,
          },
          { status: 409 },
        )
      }

      if (definition.ownerModule && !hasModule({ plan: state.tenant.plan, addons: state.tenant.addons, modules: state.modules }, definition.ownerModule)) {
        return NextResponse.json(
          {
            error: `Capability requires owner module "${definition.ownerModule}" before approval.`,
            missingOwnerModule: definition.ownerModule,
          },
          { status: 409 },
        )
      }
      if (definition.ownerFeatureKey && state.modules[definition.ownerFeatureKey] !== true) {
        return NextResponse.json(
          {
            error: `Capability requires owner capability "${definition.ownerFeatureKey}" before approval.`,
            missingOwnerCapability: definition.ownerFeatureKey,
          },
          { status: 409 },
        )
      }

      const entitlement = entitlementKeys.length > 0
        ? applyCapabilityEntitlement(definition, {
            features: state.tenant.features,
            modules: state.tenant.modules,
          })
        : null
      const settings = mergeCapabilitySettingsIntoTenantSettings(state.tenant.settings, {
        requested: { [definition.id]: false },
      })

      let appInstall: InstallTenantAppResult | null = null
      let workforceDefaultProfile: WorkforceDefaultProfileProvisioningResult | null = null
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          if (definition.appSlug) {
            appInstall = await installTenantApp({
              db: tx,
              appSlug: definition.appSlug,
              organizationId: id,
              installedBy: auth.userId,
              orgContext: {
                plan: state.tenant.plan,
                addons: state.tenant.addons,
                modules: state.modules,
              },
              existingActiveMode: "return",
            })
          }

          await tx.organization.update({
            where: { id },
            data: {
              ...(entitlement
                ? {
                    features: entitlement.features as Prisma.InputJsonValue,
                    modules: entitlement.modules as Prisma.InputJsonValue,
                  }
                : {}),
              settings: settings as Prisma.InputJsonValue,
            },
            select: { id: true },
          })

          // Capability approval is the formal enable boundary for an existing
          // tenant. Provision atomically here, never from a compatibility-only
          // legacy MTM read or an unauthenticated Workforce request.
          if (definition.id === "workforce-hrm") {
            workforceDefaultProfile = await ensureWorkforceDefaultProfile({
              db: tx,
              organizationId: id,
              initiatedByUserId: auth.userId,
            })
          }
        })
      } catch (error) {
        if (error instanceof AppInstallError) {
          return NextResponse.json(
            {
              error: error.message,
              code: error.code,
              details: error.details,
              capabilityId: definition.id,
            },
            { status: error.status },
          )
        }
        throw error
      }
      const appInstallForAudit = appInstall as InstallTenantAppResult | null

      logAudit(auth.orgId, "approve", "tenant_capability", `${id}:${definition.id}`, state.tenant.name, {
        oldValue: {
          requested: state.capabilitySettings.requested?.[definition.id] === true,
          features: state.tenant.features,
          modules: state.tenant.modules,
        },
        newValue: {
          entitlementKeys,
          appSlug: definition.appSlug ?? null,
          installationId: appInstallForAudit?.installation.id ?? null,
          provisionedResources: appInstallForAudit?.provisionedResources ?? [],
          warnings: appInstallForAudit?.warnings ?? [],
          workforceDefaultProfile,
          requested: false,
        },
      })
    }

    const updated = await readTenantCapabilityState(id, auth.role)
    return NextResponse.json({
      data: {
        capabilities: (updated?.capabilities ?? []).map(serializeCapability),
        settings: updated?.capabilitySettings ?? {},
      },
    })
  })
}
