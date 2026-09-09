import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { MtmRouteTravelPreviewSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  GOOGLE_ROUTES_MAX_STOPS,
  GOOGLE_ROUTES_PROVIDER_KEY,
  GoogleRoutesProviderError,
  createGoogleRoutesProvider,
  resolveGoogleRoutesRuntimeConfig,
} from "@/lib/mtm/google-routes"
import { mtmRouteExactScopeWhere } from "@/lib/mtm/route-access"
import { createMtmRouteTravelCalculationRequest, resolveMtmRouteTravelPolicy } from "@/lib/mtm/route-travel"
import { claimMtmRouteTravelPreview } from "@/lib/mtm/route-travel-invocation"
import { canEditMtmRouteDraft, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { logMtmRouteObservability } from "@/lib/mtm/route-observability"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" }
const TRAVEL_PREVIEW_RATE_LIMIT = { maxRequests: 4, windowMs: 60_000 }
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/

type RoutePoint = {
  id: string
  orderIndex: number
  customer: {
    latitude: number | null
    longitude: number | null
  }
}

function response(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS })
}

function error(
  status: number,
  code: string,
  messageKey: string,
  current: Record<string, unknown> | null = null,
  remedies: string[] = [],
) {
  return response({ success: false, error: code, code, messageKey, current, remedies }, status)
}

async function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

/**
 * Transient Google distance/ETA preview for an existing DRAFT. It has no
 * authority to reorder, save, publish, or mutate the canonical route.
 */
export const POST = withRouteFieldRlsAuth("read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) {
    mutationGuard.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"])
    return mutationGuard
  }

  const { id } = await params
  const parsed = parseBody(MtmRouteTravelPreviewSchema, await req.json().catch(() => null))
  if (!parsed.ok) {
    parsed.response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"])
    return parsed.response
  }
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? ""
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return error(400, "MTM_ROUTE_TRAVEL_IDEMPOTENCY_REQUIRED", "routeTravelIdempotencyRequired", null, ["RETRY_WITH_NEW_KEY"])
  }

  const actor = await actorFor(auth)
  if (!actor) return error(403, "MTM_ROUTE_SCOPE_DENIED", "routeTravelAccessDenied")

  const rateLimitKey = await hashForRateLimit(`mtm-route-travel:${auth.orgId}:${auth.userId}:${id}`)
  if (!checkRateLimit(rateLimitKey, TRAVEL_PREVIEW_RATE_LIMIT)) {
    return error(429, "MTM_ROUTE_TRAVEL_RATE_LIMITED", "routeTravelRateLimited", null, ["RETRY_LATER"])
  }

  const route = await prisma.mtmRoute.findFirst({
    where: mtmRouteExactScopeWhere(actor, auth.orgId, id),
    select: {
      id: true,
      agentId: true,
      status: true,
      version: true,
      assignments: {
        where: { removedAt: null },
        select: { agentId: true, role: true },
      },
      points: {
        where: { deletedAt: null },
        select: {
          id: true,
          orderIndex: true,
          customer: { select: { latitude: true, longitude: true } },
        },
        orderBy: { orderIndex: "asc" },
      },
    },
  })
  if (!route) return error(404, "MTM_ROUTE_NOT_FOUND", "routeTravelNotFound")

  const assignedAgentIds = route.assignments
    .filter((assignment) => assignment.role !== "OBSERVER")
    .map((assignment) => assignment.agentId)
  if (!canEditMtmRouteDraft(actor, {
    primaryAgentId: route.agentId,
    assignedAgentIds,
    status: route.status,
  })) {
    return error(409, "MTM_ROUTE_TRAVEL_NOT_EDITABLE", "routeTravelNotEditable", {
      version: route.version,
      status: route.status,
    }, ["SAVE_DRAFT", "OPEN_CHANGE_REQUEST"])
  }

  const request = createMtmRouteTravelCalculationRequest({
    routeId: route.id,
    routeVersion: route.version,
    points: route.points.map((point: RoutePoint) => ({
      id: point.id,
      orderIndex: point.orderIndex,
      latitude: point.customer.latitude,
      longitude: point.customer.longitude,
    })),
  })
  if (parsed.data.expectedVersion !== route.version || parsed.data.sourceFingerprint !== request.source.fingerprint) {
    return error(409, "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT", "routeTravelSourceConflict", {
      version: route.version,
      sourceFingerprint: request.source.fingerprint,
    }, ["RELOAD_ROUTE"])
  }
  if (route.points.length < 2) {
    return error(422, "MTM_ROUTE_TRAVEL_POINTS_INSUFFICIENT", "routeTravelPointsInsufficient", {
      pointCount: route.points.length,
    }, ["ADD_ROUTE_POINTS"])
  }
  if (route.points.length > GOOGLE_ROUTES_MAX_STOPS) {
    return error(422, "MTM_ROUTE_TRAVEL_STOP_LIMIT", "routeTravelStopLimit", {
      pointCount: route.points.length,
      maxPoints: GOOGLE_ROUTES_MAX_STOPS,
    }, ["SPLIT_ROUTE"])
  }
  if (request.points.length !== route.points.length) {
    return error(422, "MTM_ROUTE_TRAVEL_COORDINATES_INCOMPLETE", "routeTravelCoordinatesIncomplete", {
      totalPoints: route.points.length,
      locatedPoints: request.points.length,
      missingPoints: route.points.length - request.points.length,
    }, ["ADD_ROUTE_COORDINATES"])
  }

  const settings = await getMtmSettings(auth.orgId)
  const runtime = resolveGoogleRoutesRuntimeConfig(auth.orgId)
  const policy = resolveMtmRouteTravelPolicy({
    tenantCalculationEnabled: settings.routeTravelEnabled,
    tenantNavigationEnabled: settings.routeTravelNavigationEnabled,
    providerKey: runtime ? GOOGLE_ROUTES_PROVIDER_KEY : null,
  })
  if (!runtime || !policy.calculationEnabled) {
    return error(409, "MTM_ROUTE_TRAVEL_NOT_CONFIGURED", "routeTravelNotConfigured", {
      routeVersion: route.version,
      sourceFingerprint: request.source.fingerprint,
    }, ["KEEP_MANUAL_ORDER"])
  }

  const observedAt = Date.now()
  const claim = await claimMtmRouteTravelPreview({
    organizationId: auth.orgId,
    routeId: route.id,
    sourceFingerprint: request.source.fingerprint,
    actorKey: auth.userId || actor.agentId || "principal",
    idempotencyKey,
    dailyLimit: runtime.dailyLimit,
  })
  if (claim.state === "PROTECTION_UNAVAILABLE") {
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "PROTECTION_UNAVAILABLE",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    return error(503, "MTM_ROUTE_TRAVEL_PROTECTION_UNAVAILABLE", "routeTravelProtectionUnavailable", null, ["KEEP_MANUAL_ORDER", "RETRY_LATER"])
  }
  if (claim.state === "IN_FLIGHT") {
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "IN_FLIGHT",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    return error(409, "MTM_ROUTE_TRAVEL_IN_FLIGHT", "routeTravelInFlight", null, ["WAIT_FOR_CURRENT_CALCULATION"])
  }
  if (claim.state === "IDEMPOTENCY_REPLAY") {
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "IDEMPOTENCY_REPLAY",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    return error(409, "MTM_ROUTE_TRAVEL_REPLAY_SUPPRESSED", "routeTravelReplaySuppressed", null, ["RETRY_LATER"])
  }
  if (claim.state === "IDEMPOTENCY_MISMATCH") {
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "IDEMPOTENCY_MISMATCH",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    return error(409, "MTM_ROUTE_TRAVEL_IDEMPOTENCY_MISMATCH", "routeTravelIdempotencyMismatch", null, ["RETRY_WITH_NEW_KEY"])
  }
  if (claim.state === "DAILY_LIMIT_REACHED") {
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "DAILY_LIMIT_REACHED",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    return error(429, "MTM_ROUTE_TRAVEL_DAILY_LIMIT", "routeTravelDailyLimit", null, ["KEEP_MANUAL_ORDER", "RETRY_TOMORROW"])
  }

  try {
    const calculation = await createGoogleRoutesProvider(runtime).calculate(request)
    const current = await prisma.mtmRoute.findFirst({
      where: {
        ...mtmRouteExactScopeWhere(actor, auth.orgId, id),
        version: route.version,
      },
      select: { id: true, version: true },
    })
    if (!current) {
      logMtmRouteObservability({
        operation: "TRAVEL_PREVIEW",
        outcome: "STALE_AFTER_CALCULATION",
        provider: GOOGLE_ROUTES_PROVIDER_KEY,
        durationMs: Date.now() - observedAt,
        rowCount: request.points.length,
      })
      await writeTravelAudit({
        req,
        auth,
        actorAgentId: actor.agentId,
        routeId: route.id,
        routeVersion: route.version,
        sourceFingerprint: request.source.fingerprint,
        pointCount: request.points.length,
        outcome: "STALE_AFTER_CALCULATION",
      })
      return error(409, "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT", "routeTravelSourceConflict", null, ["RELOAD_ROUTE"])
    }

    const calculatedAt = new Date().toISOString()
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "SUCCESS",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    await writeTravelAudit({
      req,
      auth,
      actorAgentId: actor.agentId,
      routeId: route.id,
      routeVersion: route.version,
      sourceFingerprint: request.source.fingerprint,
      pointCount: request.points.length,
      outcome: "SUCCESS",
    })
    return response({
      success: true,
      data: {
        schemaVersion: 1,
        state: "CALCULATED",
        transient: true,
        provider: calculation.provider,
        source: calculation.source,
        calculation: {
          distanceMeters: calculation.distanceMeters,
          durationSeconds: calculation.durationSeconds,
          geometry: null,
          calculatedAt,
        },
      },
    })
  } catch (providerError) {
    const outcome = providerError instanceof GoogleRoutesProviderError
      ? providerError.code
      : "UNAVAILABLE"
    logMtmRouteObservability({
      operation: "TRAVEL_PREVIEW",
      outcome: "PROVIDER_UNAVAILABLE",
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      durationMs: Date.now() - observedAt,
      rowCount: request.points.length,
    })
    await writeTravelAudit({
      req,
      auth,
      actorAgentId: actor.agentId,
      routeId: route.id,
      routeVersion: route.version,
      sourceFingerprint: request.source.fingerprint,
      pointCount: request.points.length,
      outcome,
    })
    return error(503, "MTM_ROUTE_TRAVEL_PROVIDER_UNAVAILABLE", "routeTravelProviderUnavailable", null, ["KEEP_MANUAL_ORDER", "RETRY_LATER"])
  } finally {
    await claim.release()
  }
})

async function writeTravelAudit(input: {
  req: NextRequest
  auth: MtmRlsAuth
  actorAgentId: string | null
  routeId: string
  routeVersion: number
  sourceFingerprint: string
  pointCount: number
  outcome: string
}) {
  await writeMtmAudit({
    organizationId: input.auth.orgId,
    agentId: input.actorAgentId,
    action: MTM_ROUTE_AUDIT_ACTION.ROUTE_TRAVEL_PREVIEW,
    entity: "route",
    entityId: input.routeId,
    metadataKind: "route_travel_preview",
    // Never store Google response content, customer coordinates, API key, or
    // endpoint. The fingerprint binds only product-owned source facts.
    newData: {
      provider: GOOGLE_ROUTES_PROVIDER_KEY,
      routeVersion: input.routeVersion,
      sourceFingerprint: input.sourceFingerprint,
      pointCount: input.pointCount,
      outcome: input.outcome,
      transient: true,
    },
    req: input.req,
  }).catch((auditError) => console.warn("[MTM/routes/travel preview] audit failed", auditError))
}
