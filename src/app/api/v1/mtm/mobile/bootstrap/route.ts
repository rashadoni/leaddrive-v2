import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  hasMobilePermission,
  mobileCapabilities,
  mobileFieldPermissions,
} from "@/lib/mtm/mobile-capabilities"
import { cartoBasemapsApiKey } from "@/lib/carto-basemap"
import { buildMtmMobileCapabilityManifest } from "@/lib/mtm/mobile-capability-manifest"
import {
  MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
  MTM_MOBILE_SYNC_V2_ROUTE_OFFLINE_HORIZON_DAYS,
  MTM_MOBILE_SYNC_V2_ROUTE_TERMINAL_HISTORY_DAYS,
  MTM_MOBILE_SYNC_V2_TASK_STREAM,
  MTM_MOBILE_SYNC_V2_VISIT_STREAM,
  MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
  parseMobileSyncV2DeviceId,
  type MtmMobileSyncV2Stream,
} from "@/lib/mtm/mobile-sync-v2"
import { readMtmMobileMediaUploadPolicy } from "@/lib/mtm/mobile-media-guard"
import { readMtmMobileGpsBatchPilot } from "@/lib/mtm/mobile-gps-guard"
import { recordMtmMobileApkObservation } from "@/lib/mtm/mobile-sync-telemetry"
import { currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  workforceAttendancePolicyManifest,
  type WorkforceAttendanceAction,
} from "@/lib/workforce/attendance-policy"
import {
  resolveCurrentWorkforcePolicy,
  WorkforcePolicyResolutionError,
} from "@/lib/workforce/policy-resolution"

type MobileAttendanceManifest = {
  qrEnabled: boolean
  deviceTrustEnabled: boolean
  /** A client may act on requirements only while this is ACTIVE and version 1. */
  status: "NOT_CONFIGURED" | "ACTIVE" | "INVALID"
  enforcementVersion: 1 | null
  configVersion: string | null
  qrRequiredActions: WorkforceAttendanceAction[]
  deviceTrustRequiredActions: WorkforceAttendanceAction[]
  biometricRequiredActions: WorkforceAttendanceAction[]
}

function unconfiguredAttendanceManifest(input: {
  qrEnabled: boolean
  deviceTrustEnabled: boolean
}): MobileAttendanceManifest {
  return {
    ...input,
    status: "NOT_CONFIGURED",
    enforcementVersion: null,
    configVersion: null,
    qrRequiredActions: [],
    deviceTrustRequiredActions: [],
    biometricRequiredActions: [],
  }
}

/**
 * A mobile manifest makes the first-H5 UX honest without becoming an
 * authorization cache. Invalid or entitlement-mismatched policy material is
 * intentionally fail-closed for the client; the event endpoint independently
 * enforces the same policy inside its transaction.
 */
async function mobileAttendanceManifest(input: {
  organizationId: string
  agentId: string
  workDateKey: string
  workdayStartedAt: Date
  workforceEnabled: boolean
  qrEnabled: boolean
  deviceTrustEnabled: boolean
}): Promise<MobileAttendanceManifest> {
  const disabled = unconfiguredAttendanceManifest({
    qrEnabled: input.qrEnabled,
    deviceTrustEnabled: input.deviceTrustEnabled,
  })
  if (!input.workforceEnabled) return disabled

  let policy: Awaited<ReturnType<typeof resolveCurrentWorkforcePolicy>>
  try {
    policy = await resolveCurrentWorkforcePolicy(prisma, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workDate: input.workDateKey,
      workdayStartedAt: input.workdayStartedAt,
      resolutionAt: new Date(),
    })
  } catch (error) {
    if (error instanceof WorkforcePolicyResolutionError && error.code === "WORKFORCE_POLICY_MISSING") {
      return disabled
    }
    return { ...disabled, status: "INVALID" }
  }

  const configVersion = `${policy.id}:${policy.version}:${policy.definitionHash}`
  try {
    const attendance = workforceAttendancePolicyManifest(policy.definition)
    if (!attendance) return disabled

    const missingEntitlement = (
      (attendance.qrRequiredActions.length > 0 && !input.qrEnabled) ||
      (attendance.deviceTrustRequiredActions.length > 0 && !input.deviceTrustEnabled)
    )
    if (missingEntitlement) return { ...disabled, status: "INVALID", configVersion }

    return {
      qrEnabled: input.qrEnabled,
      deviceTrustEnabled: input.deviceTrustEnabled,
      status: "ACTIVE",
      enforcementVersion: attendance.enforcementVersion,
      configVersion,
      qrRequiredActions: attendance.qrRequiredActions,
      deviceTrustRequiredActions: attendance.deviceTrustRequiredActions,
      biometricRequiredActions: attendance.biometricRequiredActions,
    }
  } catch {
    return { ...disabled, status: "INVALID", configVersion }
  }
}

type StreamV2Pilot = { enrolled: boolean; scopeRevision: bigint; cohortEpoch: string | null }
type MediaUploadPilot = { enrolled: boolean; cohortEpoch: string | null }
type GpsBatchPilot = { enrolled: boolean; cohortEpoch: string | null }

function isMissingAdditiveV2Table(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2021"
}

/**
 * Keep bootstrap safe through the schema-first rolling-deploy interval. A
 * temporarily older database simply advertises v1; it must not take down
 * login/bootstrap for installed APKs. All other errors remain observable and
 * fail normally rather than silently enrolling a device without a cohort.
 */
async function readStreamV2Pilot(input: {
  organizationId: string
  agentId: string
  deviceId: string | null
  now: Date
  stream: MtmMobileSyncV2Stream
}): Promise<StreamV2Pilot> {
  if (!input.deviceId) return { enrolled: false, scopeRevision: BigInt(0), cohortEpoch: null }
  try {
    const [cohort, scope] = await Promise.all([
      prisma.mtmMobileSyncCohort.findFirst({
        where: {
          organizationId: input.organizationId,
          stream: input.stream,
          agentId: input.agentId,
          deviceId: input.deviceId,
          enabled: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
        },
        select: { updatedAt: true },
      }),
      prisma.mtmMobileSyncAgentScope.findUnique({
        where: {
          organizationId_stream_agentId: {
            organizationId: input.organizationId,
            stream: input.stream,
            agentId: input.agentId,
          },
        },
        select: { scopeRevision: true },
      }),
    ])
    return {
      enrolled: !!cohort,
      scopeRevision: scope?.scopeRevision ?? BigInt(0),
      cohortEpoch: cohort?.updatedAt.toISOString() ?? null,
    }
  } catch (error) {
    if (isMissingAdditiveV2Table(error)) return { enrolled: false, scopeRevision: BigInt(0), cohortEpoch: null }
    throw error
  }
}

async function readMediaUploadPilot(input: {
  organizationId: string
  agentId: string
  deviceId: string | null
  now: Date
}): Promise<MediaUploadPilot> {
  const policy = await readMtmMobileMediaUploadPolicy({
    auth: { orgId: input.organizationId, agentId: input.agentId },
    deviceId: input.deviceId,
    now: input.now,
  })
  return { enrolled: policy.isolated, cohortEpoch: policy.cohortEpoch }
}

async function readGpsBatchPilot(input: {
  organizationId: string
  agentId: string
  deviceId: string | null
  now: Date
}): Promise<GpsBatchPilot> {
  const pilot = await readMtmMobileGpsBatchPilot({
    auth: { orgId: input.organizationId, agentId: input.agentId },
    deviceId: input.deviceId,
    now: input.now,
  })
  return { enrolled: pilot.enrolled, cohortEpoch: pilot.cohortEpoch }
}

/**
 * GET /api/v1/mtm/mobile/bootstrap
 *
 * The first authenticated mobile contract after login. Legacy v1 sync fields
 * remain deliberately null; a real revision is advertised only inside the
 * additive manifest for an exact v2 route-pilot cohort. Clients must treat a
 * null version as "legacy/unversioned", never as "cache is current".
 */
export const GET = withMobileRls(async (req, auth) => {
  try {
    const deviceId = parseMobileSyncV2DeviceId(req.headers.get("x-field-device-id"))
    const now = new Date()
    const [agent, organization, settings, routeSyncV2Pilot, visitV2Pilot, taskV2Pilot, workforceV2Pilot, gpsBatchPilot, mediaUploadPilot] = await Promise.all([
      prisma.mtmAgent.findFirst({
        where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          canPlanOwnRoutes: true,
          canSelfPublishRoutes: true,
        },
      }),
      prisma.organization.findFirst({
        where: { id: auth.orgId, isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          addons: true,
          features: true,
          modules: true,
        },
      }),
      getMtmSettings(auth.orgId),
      // An absent device header keeps old APK bootstrap behavior exactly as it
      // was. A valid header still has no power by itself: both this manifest
      // advertisement and the v2 endpoint independently require this exact
      // server-owned agent/device cohort row.
      readStreamV2Pilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      }),
      readStreamV2Pilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
        stream: MTM_MOBILE_SYNC_V2_VISIT_STREAM,
      }),
      readStreamV2Pilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
        stream: MTM_MOBILE_SYNC_V2_TASK_STREAM,
      }),
      readStreamV2Pilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
        stream: MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
      }),
      readGpsBatchPilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
      }),
      readMediaUploadPilot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        now,
      }),
    ])

    if (!agent || !organization) {
      return NextResponse.json({ error: "Mobile principal is no longer active" }, { status: 403 })
    }
    if (!auth.tenantCapabilities.routeField && !auth.tenantCapabilities.workforceHrm) {
      return NextResponse.json({
        success: false,
        code: "TENANT_CAPABILITY_DISABLED",
        capabilityId: null,
        error: "Route & Field or Workforce HRM is not enabled for this tenant.",
      }, { status: 403 })
    }

    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    // The mobile auth resolver read these entitlements together with token
    // revocation. Reuse that snapshot for both legacy bootstrap fields and
    // the additive manifest so a capability transition cannot split them.
    const routeFieldEnabled = auth.tenantCapabilities.routeField
    const workforceEnabled = auth.tenantCapabilities.workforceHrm
    const canPlanOwnRoutes = routeFieldEnabled
      && hasMobilePermission(auth.role, "ROUTE_SELF_PLAN")
      && (agent.role !== "AGENT" || agent.canPlanOwnRoutes)
    // Publishing remains manager-controlled unless the tenant circuit breaker
    // and this specific field agent both grant it.
    const canSelfPublishRoutes = routeFieldEnabled && (agent.role !== "AGENT" || (
      canPlanOwnRoutes
      && agent.canSelfPublishRoutes === true
      && settings.routeSelfPublish
    ))
    const permissions = mobileFieldPermissions(auth.role, {
      routeField: routeFieldEnabled,
      workforceHrm: workforceEnabled,
      canPlanOwnRoutes,
      canSelfPublishRoutes,
    })
    const manifest = buildMtmMobileCapabilityManifest({
      organization,
      auth,
      timezone,
      routeSyncV2Pilot,
      visitSyncV2Pilot: visitV2Pilot,
      taskSyncV2Pilot: taskV2Pilot,
      workforceSyncV2Pilot: workforceV2Pilot,
      gpsBatchPilot,
      mediaUploadPilot,
    })
    // All supported Field clients call bootstrap. This provides the S7 fleet
    // census without storing client state or withholding the v1 contract from
    // an old APK. The telemetry helper hashes tenant/principal identifiers and
    // rejects unsafe version strings before logging.
    recordMtmMobileApkObservation({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      apkVersion: req.headers.get("x-field-apk-version"),
      protocolPreferred: manifest.protocol.preferred,
      cohorts: {
        routes: manifest.syncV2.routes,
        visits: manifest.syncV2.visits,
        tasks: manifest.syncV2.tasks,
        workforce: manifest.syncV2.workforce,
        gps: manifest.gps.batches,
        media: manifest.media.uploads,
      },
    })
    const date = currentDateKey(now, timezone)
    const todayWorkDate = localDateKeyToUtc(date, timezone)
    // A Route Field agent needs only their own field-session boundary to
    // start a route and transmit GPS. This is deliberately narrower than the
    // Workforce module: it does not expose a workforce stream, attendance
    // policy, requests, timesheets, or team data. When Workforce is enabled
    // its stricter read permission continues to provide the same canonical
    // workday projection.
    const fieldSessionEnabled = routeFieldEnabled && auth.role === "AGENT"
    const workday = fieldSessionEnabled || (workforceEnabled && hasMobilePermission(auth.role, "WORKTIME_SELF_READ"))
      ? await prisma.mtmAgentWorkday.findFirst({
          where: {
            organizationId: auth.orgId,
            agentId: auth.agentId,
            // A shift may remain open past tenant midnight (for example after a
            // lost connection). Returning only today's row made the app forget
            // that shift and offer a second START which the server then rejected.
            // Include the current local date for completed-day history, but always
            // keep a still-open STARTED/PAUSED shift visible for remediation.
            OR: [
              { status: { in: ["STARTED", "PAUSED"] } },
              { workDate: todayWorkDate },
            ],
          },
          orderBy: { startedAt: "desc" },
          select: { id: true, workDate: true, status: true, startedAt: true, pausedAt: true, completedAt: true },
      })
      : null
    const qrEnabled = workforceEnabled && auth.tenantCapabilities.attendanceQr === true
    const deviceTrustEnabled = workforceEnabled && auth.tenantCapabilities.attendanceDeviceTrust === true
    const attendance = await mobileAttendanceManifest({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      workDateKey: workday?.workDate.toISOString().slice(0, 10) ?? date,
      workdayStartedAt: workday?.startedAt ?? new Date(),
      workforceEnabled,
      qrEnabled,
      deviceTrustEnabled,
    })

    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: 1,
        protocol: { min: 1, preferred: 1 },
        tenant: { id: organization.id, name: organization.name, slug: organization.slug },
        principal: { id: agent.id, name: agent.name, email: agent.email, role: agent.role },
        // `capabilities` remains for legacy APKs. New clients use the split
        // modules and granular permissions below.
        capabilities: mobileCapabilities(auth.role),
        permissions,
        modules: {
          routeField: { enabled: routeFieldEnabled, scopeVersion: null },
          workforceHrm: { enabled: workforceEnabled, scopeVersion: null },
          workforce: {
            enabled: workforceEnabled,
            capabilityId: "workforce-hrm",
            configVersion: null,
            cursor: null,
            attendance,
          },
          routes: {
            enabled: routeFieldEnabled,
            capabilityId: "route-field",
            configVersion: null,
          },
        },
        timezone,
        // Tenant policies the field app must obey. Server-authoritative: the
        // app has no local override, so a tenant that turns the plaque off
        // cannot have it reappear from a stale build's default.
        policies: {
          photoWatermark: routeFieldEnabled ? settings.photoWatermarkEnabled : false,
          // The server remains the enforcement point; this is an honest UI
          // capability so a field agent never sees a route-planning action
          // that their administrator has turned off.
          canPlanOwnRoutes,
          canSelfPublishRoutes,
          workforce: { enabled: workforceEnabled, configVersion: null, attendance },
        },
        // The same tenant-owned labels and data scopes drive both web and
        // mobile planners. The APK must never fall back to hard-coded
        // "doctor/pharmacy" buttons after an administrator changes them.
        routeTargetTypes: routeFieldEnabled ? settings.routeTargetTypes : [],
        sync: routeFieldEnabled ? {
          horizon: "ACTIVE_FIELD_SCOPE",
          scopeVersion: null,
          configVersion: null,
          streams: ["routes", "visits", "customers", "contacts", "tasks"],
          // This announces the approved device-cache policy without enabling
          // v2. The current v1 cache does not consume or act on this policy.
          offlineHorizon: {
            routeDays: MTM_MOBILE_SYNC_V2_ROUTE_OFFLINE_HORIZON_DAYS,
            terminalHistoryDays: MTM_MOBILE_SYNC_V2_ROUTE_TERMINAL_HISTORY_DAYS,
          },
        } : { horizon: "ACTIVE_FIELD_SCOPE", scopeVersion: null, configVersion: null },
        serverTime: now.toISOString(),
        // Additive v1 field. Older APKs ignore it; newer APKs use it to avoid
        // disabled endpoints before the corresponding mutation is attempted.
        manifest,
        workday,
        // Field UX audit 2026-09-05, task B16: the app's GPS and live maps
        // render CARTO raster tiles in a WebView and showed "API KEY REQUIRED"
        // without a key. The key is the same browser-facing, referrer-bound
        // value the web maps use (src/lib/carto-basemap.ts); it is inlined at
        // build time, so older builds simply return null here.
        maps: { cartoBasemapsApiKey: routeFieldEnabled ? cartoBasemapsApiKey() : null },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/bootstrap GET]", error)
    return NextResponse.json({ error: "Failed to load mobile bootstrap" }, { status: 500 })
  }
})
