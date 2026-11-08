import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { RoutePublishSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  MtmRoutePublishError,
  publishMtmRouteInTransaction,
  type MtmRoutePublishOutcome,
} from "@/lib/mtm/route-publish"

/**
 * POST /api/v1/mtm/routes/[id]/publish — DRAFT → PLANNED.
 *
 * The publish itself (checks, schedule locks, conflicts, manager override,
 * notifications) lives in `publishMtmRouteInTransaction`, shared with the
 * voice assistant (2026-11-08); this handler only maps its outcome to the
 * answers the route screen and the mobile app have always read.
 */

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const parsed = parseBody(RoutePublishSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response

  const now = new Date()
  let outcome: MtmRoutePublishOutcome
  try {
    outcome = await prisma.$transaction(
      (tx: Prisma.TransactionClient) => publishMtmRouteInTransaction(tx, {
        organizationId: auth.orgId,
        userId: auth.userId || null,
        actor,
        routeId: id,
        expectedVersion: parsed.data.expectedVersion,
        overrideReason: parsed.data.overrideReason ?? null,
        now,
      }),
      { maxWait: 5_000, timeout: 10_000 },
    )
  } catch (error) {
    if (!(error instanceof MtmRoutePublishError)) throw error
    switch (error.code) {
      case "NOT_FOUND":
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      case "MTM_ROUTE_SCOPE_DENIED":
        return forbidden()
      case "ROUTE_TRANSITION_INVALID":
        return NextResponse.json({ error: "Only draft routes may be published", code: error.code }, { status: 409 })
      case "ROUTE_EMPTY":
        return NextResponse.json({ error: "A route must contain at least one stop", code: error.code }, { status: 409 })
      case "ROUTE_POINT_TIME_CONFLICT":
        return NextResponse.json({
          error: "Two route stops cannot use the same meeting time",
          code: error.code,
          conflicts: error.details.conflicts,
        }, { status: 409 })
      case "ROUTE_CONFLICT":
        return NextResponse.json({
          error: "Route conflicts require manager approval",
          code: error.code,
          conflicts: error.details.conflicts,
        }, { status: 409 })
      case "ROUTE_VERSION_CONFLICT": {
        const current = await prisma.mtmRoute.findFirst({
          where: { id, organizationId: auth.orgId, deletedAt: null },
          select: { version: true, publishedVersion: true, updatedAt: true, status: true },
        }).catch(() => null)
        return NextResponse.json({
          error: "This route was changed by another user. Reload it before publishing.",
          code: error.code,
          currentVersion: current?.version ?? error.details.currentVersion,
          publishedVersion: current?.publishedVersion,
          updatedAt: current?.updatedAt ?? error.details.updatedAt,
          status: current?.status,
        }, { status: 409 })
      }
    }
  }

  const { route } = outcome
  if (outcome.kind === "already") {
    return NextResponse.json({
      success: true,
      data: {
        id: route.id,
        status: "PLANNED",
        version: route.version,
        publishedVersion: route.publishedVersion,
        publishedAt: route.publishedAt,
      },
      idempotent: true,
    })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: route.agentId,
    action: MTM_ROUTE_AUDIT_ACTION.ROUTE_PUBLISH,
    entity: "route",
    entityId: route.id,
    metadataKind: "route_publish",
    oldData: { status: route.status, version: route.version },
    newData: {
      status: "PLANNED",
      version: outcome.publishedVersion,
      publishedVersion: outcome.publishedVersion,
      conflicts: outcome.planningSignals.conflicts,
      coordination: outcome.planningSignals.coordination,
      managerOverride: outcome.managerOverride,
    },
    req,
  }).catch((error) => console.warn("[MTM/routes/[id]/publish] audit failed", error))

  return NextResponse.json({
    success: true,
    data: {
      id: route.id,
      status: "PLANNED",
      version: outcome.publishedVersion,
      publishedVersion: outcome.publishedVersion,
      publishedAt: outcome.publishedAt,
    },
    meta: { coordination: outcome.planningSignals.coordination },
  })
})
