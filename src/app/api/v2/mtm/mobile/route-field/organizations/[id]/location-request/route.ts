import { z } from "zod"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { checkRateLimit } from "@/lib/rate-limit"
import { agentPermissionDeniedBody, agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  CUSTOMER_LOCATION_REQUEST_ERROR,
  LOCATION_REQUEST_COMMENT_MAX,
  MTM_LOCATION_REQUEST_IDEMPOTENCY_MISMATCH,
  MTM_LOCATION_REQUEST_NOT_FOUND,
  MTM_LOCATION_REQUEST_PENDING,
  customerLocationRequestForAgent,
  evaluateCustomerLocationRequest,
  sameCustomerLocationRequest,
} from "@/lib/mtm/customer-location-request"

type RouteContext = { params: Promise<{ id: string }> }

// A handful of customers in a day is honest use; a hundred requests an hour is a script.
const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60 * 60_000 }

const point = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})
const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  // Where the agent says the customer is.
  proposed: point,
  // Where the phone itself is, as it knows it at this moment.
  agent: point.extend({
    accuracyMeters: z.number().finite().min(0).max(100_000),
    // Counted by the phone: «this fix is N seconds old». A phone whose clock
    // is wrong is then neither refused nor believed about a place it left.
    fixAgeSeconds: z.number().finite().min(0).max(86_400),
    isMock: z.boolean().nullable().optional(),
  }),
  comment: z.string().trim().max(LOCATION_REQUEST_COMMENT_MAX).nullable().optional(),
})

const requestSelect = {
  id: true,
  status: true,
  customerId: true,
  requestedByAgentId: true,
  proposedLatitude: true,
  proposedLongitude: true,
  movedMeters: true,
  decisionComment: true,
  submittedAt: true,
  reviewedAt: true,
} satisfies Prisma.MtmCustomerLocationRequestSelect

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

const notFound = () => noStoreJson({ error: "Not found", code: "MTM_ROUTE_FIELD_ORGANIZATION_NOT_FOUND" }, { status: 404 })

/** The agent himself, and nobody acting for him. */
async function agentOf(auth: Parameters<Parameters<typeof withMobileRls>[0]>[1]) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId || actor.agentId !== auth.agentId) return null
  return actor as typeof actor & { agentId: string }
}

/**
 * POST /api/v2/mtm/mobile/route-field/organizations/:id/location-request
 *
 * «Клиент здесь»: the agent, standing at the customer, asks for its pin to be
 * moved to where the customer really is. Nothing about the customer changes
 * here — a manager accepts the new place or leaves the old one
 * (src/app/api/v1/mtm/customer-location-requests).
 *
 * Refused with a code the field app has a sentence for: a phone that does not
 * know where it is, a fix it took earlier, a mocked position, a pin put far
 * from where the agent stands, a pin that is already there
 * (src/lib/mtm/customer-location-request.ts). One request about a customer
 * waits at a time: the second is told so, with the one that is waiting.
 */
export const POST = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }
  const actor = await agentOf(auth)
  if (!actor) return noStoreJson({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })

  const settings = await getMtmSettings(auth.orgId)
  // The organization may switch the request off («Что может агент»).
  if (!agentPermissionEnabled(settings, "customerLocationRequest")) {
    return noStoreJson(agentPermissionDeniedBody("customerLocationRequest"), { status: 403 })
  }
  if (!checkRateLimit(`mtm-customer-location-request:${auth.orgId}:${actor.agentId}`, WRITE_RATE_LIMIT)) {
    return noStoreJson({ error: "Too many requests", code: "MTM_LOCATION_REQUEST_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600" } })
  }

  const { id: rawId } = await params
  const customerId = rawId.trim()
  if (!customerId) return noStoreJson({ error: "Organization id is required", code: "MTM_ROUTE_FIELD_ORGANIZATION_ID_REQUIRED" }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return noStoreJson({ error: parsed.error.issues[0]?.message || "Invalid request", code: "MTM_LOCATION_REQUEST_INVALID" }, { status: 400 })
  }
  const body = parsed.data
  // 0,0 is «no coordinates» written as a number, from either of the two.
  if (normalizeMtmCoordinates(body.proposed).latitude === null || normalizeMtmCoordinates(body.agent).latitude === null) {
    return noStoreJson({ error: "Coordinates are required", code: "MTM_LOCATION_REQUEST_INVALID" }, { status: 400 })
  }

  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  // The same customers the agent's card of an organization opens for: his own, as of today.
  const customer = await prisma.mtmCustomer.findFirst({
    where: {
      id: customerId,
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      objectType: { not: "DOCTOR" },
      AND: [customerScopeForActor(actor, asOf)],
    },
    select: { id: true, name: true, latitude: true, longitude: true },
  })
  if (!customer) return notFound()

  // A sending that was already taken, sent again (a lost answer, a second tap).
  const sent = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey },
    select: requestSelect,
  })
  if (sent) {
    if (sent.requestedByAgentId !== actor.agentId || !sameCustomerLocationRequest(sent, customer.id, body.proposed)) {
      return noStoreJson({ error: "Idempotency key was reused", code: MTM_LOCATION_REQUEST_IDEMPOTENCY_MISMATCH }, { status: 409 })
    }
    return noStoreJson({ success: true, data: { request: customerLocationRequestForAgent(sent, actor.agentId) }, idempotent: true })
  }

  const now = new Date()
  const verdict = evaluateCustomerLocationRequest(body, customer, now)
  if (!verdict.ok) {
    return noStoreJson({
      error: "The request cannot be taken",
      code: CUSTOMER_LOCATION_REQUEST_ERROR[verdict.problem],
      details: verdict.details,
    }, { status: 422 })
  }

  let created
  try {
    created = await prisma.mtmCustomerLocationRequest.create({
      data: {
        organizationId: auth.orgId,
        customerId: customer.id,
        requestedByAgentId: actor.agentId,
        idempotencyKey: body.idempotencyKey,
        ...verdict.facts,
        comment: body.comment || null,
        submittedAt: now,
      },
      select: requestSelect,
    })
  } catch (error) {
    // Held by the database (one waiting request per customer, one row per
    // key): two phones at the same door cannot both get through a read.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const waiting = await prisma.mtmCustomerLocationRequest.findFirst({
      where: { organizationId: auth.orgId, customerId: customer.id, status: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
      select: requestSelect,
    })
    return noStoreJson({
      error: "A request about this customer is already waiting",
      code: MTM_LOCATION_REQUEST_PENDING,
      data: { request: waiting ? customerLocationRequestForAgent(waiting, actor.agentId) : null },
    }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_LOCATION_REQUEST,
    entity: "customer_location_request",
    entityId: created.id,
    metadataKind: "customer_location_request",
    newData: {
      customerId: customer.id,
      movedMeters: verdict.facts.movedMeters,
      agentToProposedMeters: verdict.facts.agentToProposedMeters,
      agentAccuracyMeters: Math.round(verdict.facts.agentAccuracyMeters),
    },
    req,
  }).catch((error) => console.warn("[MTM/route-field/location-request] audit failed", error))

  return noStoreJson({ success: true, data: { request: customerLocationRequestForAgent(created, actor.agentId) } }, { status: 201 })
}, { requiredCapability: "route-field" })

/**
 * DELETE /api/v2/mtm/mobile/route-field/organizations/:id/location-request
 *
 * The agent takes back his own request about this customer while it is still
 * waiting. Somebody else's request, and one a manager has already answered,
 * are not his to take back: both read «нет такого».
 */
export const DELETE = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }
  const actor = await agentOf(auth)
  if (!actor) return noStoreJson({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })

  const { id: rawId } = await params
  const customerId = rawId.trim()
  if (!customerId) return noStoreJson({ error: "Organization id is required", code: "MTM_ROUTE_FIELD_ORGANIZATION_ID_REQUIRED" }, { status: 400 })

  const waiting = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { organizationId: auth.orgId, customerId, requestedByAgentId: actor.agentId, status: "SUBMITTED" },
    select: { id: true },
  })
  if (!waiting) return noStoreJson({ error: "Not found", code: MTM_LOCATION_REQUEST_NOT_FOUND }, { status: 404 })
  const now = new Date()
  // Only while it still waits: a manager's answer that landed a moment ago stands.
  const cancelled = await prisma.mtmCustomerLocationRequest.updateMany({
    where: { id: waiting.id, organizationId: auth.orgId, status: "SUBMITTED" },
    data: { status: "CANCELLED", reviewedAt: now },
  })
  if (cancelled.count !== 1) return noStoreJson({ error: "Not found", code: MTM_LOCATION_REQUEST_NOT_FOUND }, { status: 404 })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_LOCATION_REQUEST,
    entity: "customer_location_request",
    entityId: waiting.id,
    metadataKind: "customer_location_request",
    oldData: { status: "SUBMITTED" },
    newData: { status: "CANCELLED", customerId },
    req,
  }).catch((error) => console.warn("[MTM/route-field/location-request] audit failed", error))

  return noStoreJson({ success: true, data: { id: waiting.id, status: "CANCELLED" } })
}, { requiredCapability: "route-field" })
