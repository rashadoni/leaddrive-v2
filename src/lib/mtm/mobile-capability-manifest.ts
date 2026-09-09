import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { hasMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

/**
 * These keys intentionally live below the legacy MTM tenant module. An
 * explicit false takes precedence, while an absent key retains the existing
 * `mtm` entitlement for older tenants and APKs.
 */
export type MtmMobileTenantModule = "routeField" | "workforceHrm" | "commercial"

type ManifestOrganization = {
  id: string
  plan: string
  addons: unknown
  features: unknown
  modules: unknown
}

type TenantModuleEntitlements = Record<MtmMobileTenantModule, boolean>

export type MtmMobileCapabilityManifest = {
  version: 1
  protocol: { min: 1; preferred: 1 | 2 }
  tenant: { id: string; timezone: string }
  principal: { id: string; role: string }
  modules: Record<MtmMobileTenantModule, { enabled: boolean; scopeVersion: string | null }>
  streams: string[]
  policiesVersion: null
  /** Every read-only v2 stream has an independent exact server-side cohort. */
  syncV2: {
    routes: boolean
    routesEpoch: string | null
    visits: boolean
    visitsEpoch: string | null
    tasks: boolean
    tasksEpoch: string | null
    workforce: boolean
    workforceEpoch: string | null
  }
  /** GPS batching has its own cohort and can be rolled back independently. */
  gps: { batches: boolean; batchesEpoch: string | null }
  /**
   * Separate from route pull v2: a cohort-gated media supervisor owns retry,
   * rate/backpressure and local-file reconciliation. Old APKs ignore this
   * additive field and retain protocol-v1 media behavior.
   */
  media: { uploads: boolean; uploadsEpoch: string | null }
  serverTime: string
}

/**
 * Resolve the tenant half of the entitlement separately from role permission.
 * Reuse the canonical tenant-capability resolver: a new routes-only tenant
 * can carry `route-field: true` without the legacy `mtm` module, while an
 * explicit false still soft-disables a legacy MTM grant. `commercial` remains
 * hard-disabled rather than becoming an accidental legacy default.
 */
export function resolveMtmMobileTenantModules(organization: Omit<ManifestOrganization, "id">): TenantModuleEntitlements {
  const fields = {
    plan: organization.plan,
    addons: organization.addons,
    features: organization.features,
    modules: organization.modules,
  }

  return {
    routeField: isTenantCapabilityEnabled("route-field", fields),
    workforceHrm: isTenantCapabilityEnabled("workforce-hrm", fields),
    commercial: false,
  }
}

export function buildMtmMobileCapabilityManifest(input: {
  organization: ManifestOrganization
  auth: Pick<MobileAuthResult, "agentId" | "role"> & Partial<Pick<MobileAuthResult, "tenantCapabilities">>
  timezone: string
  routeSyncV2Pilot?: { enrolled: boolean; scopeRevision: bigint; cohortEpoch: string | null }
  visitSyncV2Pilot?: { enrolled: boolean; scopeRevision: bigint; cohortEpoch: string | null }
  taskSyncV2Pilot?: { enrolled: boolean; scopeRevision: bigint; cohortEpoch: string | null }
  workforceSyncV2Pilot?: { enrolled: boolean; scopeRevision: bigint; cohortEpoch: string | null }
  gpsBatchPilot?: { enrolled: boolean; cohortEpoch: string | null }
  mediaUploadPilot?: { enrolled: boolean; cohortEpoch: string | null }
  now?: Date
}): MtmMobileCapabilityManifest {
  // Mobile auth resolves entitlements together with session revocation. When
  // that authoritative snapshot is available, never recompute it from a
  // second Organization read: a just-disabled route or a Workforce-only
  // tenant must see the same decision in legacy bootstrap fields and this
  // additive manifest. The organization fallback keeps this pure helper
  // backwards-compatible for isolated callers and older tests.
  const tenantModules = input.auth.tenantCapabilities
    ? {
        routeField: input.auth.tenantCapabilities.routeField === true,
        workforceHrm: input.auth.tenantCapabilities.workforceHrm === true,
        commercial: false,
      }
    : resolveMtmMobileTenantModules(input.organization)
  const routeFieldEnabled = tenantModules.routeField && hasMobilePermission(input.auth.role, "ROUTE_EXECUTE")
  const workforceHrmEnabled = tenantModules.workforceHrm && hasMobilePermission(input.auth.role, "WORKTIME_SELF_READ")
  const routeSyncV2Pilot = input.routeSyncV2Pilot
  const visitSyncV2Pilot = input.visitSyncV2Pilot
  const taskSyncV2Pilot = input.taskSyncV2Pilot
  const workforceSyncV2Pilot = input.workforceSyncV2Pilot
  // Cohort enrollment is a second, server-side fence. A client never opts
  // into v2 merely by claiming a protocol version in its request.
  const routeSyncV2Enabled = routeFieldEnabled &&
    routeSyncV2Pilot?.enrolled === true &&
    typeof routeSyncV2Pilot.cohortEpoch === "string"
  const visitSyncV2Enabled = routeFieldEnabled &&
    visitSyncV2Pilot?.enrolled === true &&
    typeof visitSyncV2Pilot.cohortEpoch === "string"
  const taskSyncV2Enabled = routeFieldEnabled &&
    taskSyncV2Pilot?.enrolled === true &&
    typeof taskSyncV2Pilot.cohortEpoch === "string"
  const workforceSyncV2Enabled = workforceHrmEnabled &&
    workforceSyncV2Pilot?.enrolled === true &&
    typeof workforceSyncV2Pilot.cohortEpoch === "string"
  const gpsBatchEnabled = routeFieldEnabled &&
    input.gpsBatchPilot?.enrolled === true &&
    typeof input.gpsBatchPilot.cohortEpoch === "string"
  const mediaUploadsEnabled = routeFieldEnabled &&
    input.mediaUploadPilot?.enrolled === true &&
    typeof input.mediaUploadPilot.cohortEpoch === "string"
  const streams: string[] = []
  if (routeFieldEnabled) {
    streams.push("routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications")
  }
  if (workforceHrmEnabled) streams.push("workforce")

  return {
    version: 1,
    // Old APKs remain valid v1 clients. Preferred v2 is advertised only after
    // schema deployment and exact device cohort enrollment.
    protocol: {
      min: 1,
      preferred: routeSyncV2Enabled || visitSyncV2Enabled || taskSyncV2Enabled || workforceSyncV2Enabled || gpsBatchEnabled ? 2 : 1,
    },
    tenant: { id: input.organization.id, timezone: input.timezone },
    principal: { id: input.auth.agentId, role: input.auth.role },
    modules: {
      routeField: {
        enabled: routeFieldEnabled,
        scopeVersion: routeSyncV2Enabled
          ? `routes:${routeSyncV2Pilot!.scopeRevision.toString()}`
          : null,
      },
      workforceHrm: {
        enabled: workforceHrmEnabled,
        scopeVersion: workforceSyncV2Enabled
          ? `workforce:${workforceSyncV2Pilot!.scopeRevision.toString()}`
          : null,
      },
      commercial: { enabled: false, scopeVersion: null },
    },
    streams,
    // There is no complete, trustworthy revision across all scopes/settings
    // yet. Null means unversioned, never "cache is current".
    policiesVersion: null,
    // Stable across ordinary bootstrap calls. It changes when the exact cohort
    // row is re-enrolled/revoked or its authorized route scope changes, so an
    // APK can reopen a server-403 circuit without turning every login into a
    // full snapshot resync.
    syncV2: {
      routes: routeSyncV2Enabled,
      routesEpoch: routeSyncV2Enabled
        ? `${routeSyncV2Pilot!.cohortEpoch}:routes:${routeSyncV2Pilot!.scopeRevision.toString()}`
        : null,
      visits: visitSyncV2Enabled,
      visitsEpoch: visitSyncV2Enabled
        ? `${visitSyncV2Pilot!.cohortEpoch}:visits:${visitSyncV2Pilot!.scopeRevision.toString()}`
        : null,
      tasks: taskSyncV2Enabled,
      tasksEpoch: taskSyncV2Enabled
        ? `${taskSyncV2Pilot!.cohortEpoch}:tasks:${taskSyncV2Pilot!.scopeRevision.toString()}`
        : null,
      workforce: workforceSyncV2Enabled,
      workforceEpoch: workforceSyncV2Enabled
        ? `${workforceSyncV2Pilot!.cohortEpoch}:workforce:${workforceSyncV2Pilot!.scopeRevision.toString()}`
        : null,
    },
    gps: {
      batches: gpsBatchEnabled,
      batchesEpoch: gpsBatchEnabled
        ? `${input.gpsBatchPilot!.cohortEpoch}:gps`
        : null,
    },
    media: {
      uploads: mediaUploadsEnabled,
      uploadsEpoch: mediaUploadsEnabled
        ? `${input.mediaUploadPilot!.cohortEpoch}:media`
        : null,
    },
    serverTime: (input.now ?? new Date()).toISOString(),
  }
}

export async function requireMtmMobileTenantModule(
  auth: Pick<MobileAuthResult, "orgId">,
  module: Exclude<MtmMobileTenantModule, "commercial">,
): Promise<NextResponse | null> {
  const organization = await prisma.organization.findFirst({
    where: { id: auth.orgId, isActive: true },
    select: { id: true, plan: true, addons: true, features: true, modules: true },
  })
  if (!organization) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  const entitlements = resolveMtmMobileTenantModules(organization)
  if (entitlements[module]) return null
  return NextResponse.json(
    {
      error: "This mobile capability is disabled for the tenant",
      code: "MTM_MOBILE_TENANT_CAPABILITY_REQUIRED",
      module,
    },
    { status: 403 },
  )
}

/** Entity ownership used to validate a mixed v1 push batch before any write. */
export function mtmMobileModuleForSyncEntity(entity: unknown): Exclude<MtmMobileTenantModule, "commercial"> | null {
  if (entity === "workdays" || entity === "hrmRequests") return "workforceHrm"
  if (
    entity === "visits"
    || entity === "visitActions"
    || entity === "tasks"
    || entity === "taskEvents"
    || entity === "commitments"
    || entity === "commitmentFulfillments"
    || entity === "messages"
    || entity === "messageReceipts"
    || entity === "documentStates"
    || entity === "brandPotentials"
  ) return "routeField"
  return null
}
