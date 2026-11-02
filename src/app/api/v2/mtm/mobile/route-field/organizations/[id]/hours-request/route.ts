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
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MtmWorkingHoursSchema, normalizeWorkingHours } from "@/lib/mtm/customer-hours"
import {
  HOURS_REQUEST_COMMENT_MAX,
  MTM_HOURS_REQUEST_IDEMPOTENCY_MISMATCH,
  MTM_HOURS_REQUEST_INVALID,
  MTM_HOURS_REQUEST_NOT_FOUND,
  MTM_HOURS_REQUEST_PENDING,
  MTM_HOURS_REQUEST_UNCHANGED,
  customerHoursRequestForAgent,
  hoursRequestChangesSomething,
} from "@/lib/mtm/customer-hours-request"

type RouteContext = { params: Promise<{ id: string }> }

// A handful of places in a day is honest use; a hundred requests an hour is a script.
const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60 * 60_000 }

const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  hours: MtmWorkingHoursSchema,
  comment: z.string().trim().max(HOURS_REQUEST_COMMENT_MAX).nullable().optional(),
})

const requestSelect = {
  id: true,
  status: true,
  customerId: true,
  requestedByAgentId: true,
  proposedHours: true,
  decisionComment: true,
  submittedAt: true,
  reviewedAt: true,
} satisfies Prisma.MtmCustomerHoursRequestSelect

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
 * POST /api/v2/mtm/mobile/route-field/organizations/:id/hours-request
 *
 * «Часы не те?»: the agent at a place proposes its real «часы приёма». Nothing
 * about the place changes here — a manager accepts the hours or leaves the old
 * ones (src/app/api/v1/mtm/customer-hours-requests). One request about a place
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
  if (!checkRateLimit(`mtm-customer-hours-request:${auth.orgId}:${actor.agentId}`, WRITE_RATE_LIMIT)) {
    return noStoreJson({ error: "Too many requests", code: "MTM_HOURS_REQUEST_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600" } })
  }

  const { id: rawId } = await params
  const customerId = rawId.trim()
  if (!customerId) return noStoreJson({ error: "Organization id is required", code: "MTM_ROUTE_FIELD_ORGANIZATION_ID_REQUIRED" }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return noStoreJson({ error: parsed.error.issues[0]?.message || "Invalid request", code: MTM_HOURS_REQUEST_INVALID }, { status: 400 })
  }
  const body = parsed.data
  const proposed = normalizeWorkingHours(body.hours)

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  // The same places the agent's card of an organization opens for: his own, as of today.
  const customer = await prisma.mtmCustomer.findFirst({
    where: {
      id: customerId,
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      objectType: { not: "DOCTOR" },
      AND: [customerScopeForActor(actor, asOf)],
    },
    select: { id: true, name: true, workingHours: true },
  })
  if (!customer) return notFound()

  // A sending that was already taken, sent again (a lost answer, a second tap).
  const sent = await prisma.mtmCustomerHoursRequest.findFirst({
    where: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey },
    select: requestSelect,
  })
  if (sent) {
    if (sent.requestedByAgentId !== actor.agentId || sent.customerId !== customer.id) {
      return noStoreJson({ error: "Idempotency key was reused", code: MTM_HOURS_REQUEST_IDEMPOTENCY_MISMATCH }, { status: 409 })
    }
    return noStoreJson({ success: true, data: { request: customerHoursRequestForAgent(sent, actor.agentId) }, idempotent: true })
  }

  if (!hoursRequestChangesSomething(customer.workingHours, proposed)) {
    return noStoreJson({ error: "These are the hours the place already has", code: MTM_HOURS_REQUEST_UNCHANGED }, { status: 422 })
  }

  const now = new Date()
  let created
  try {
    created = await prisma.mtmCustomerHoursRequest.create({
      data: {
        organizationId: auth.orgId,
        customerId: customer.id,
        requestedByAgentId: actor.agentId,
        idempotencyKey: body.idempotencyKey,
        previousHours: customer.workingHours === null ? Prisma.DbNull : customer.workingHours as Prisma.InputJsonValue,
        proposedHours: proposed as unknown as Prisma.InputJsonValue,
        comment: body.comment || null,
        submittedAt: now,
      },
      select: requestSelect,
    })
  } catch (error) {
    // Held by the database (one waiting request per place, one row per key).
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const waiting = await prisma.mtmCustomerHoursRequest.findFirst({
      where: { organizationId: auth.orgId, customerId: customer.id, status: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
      select: requestSelect,
    })
    return noStoreJson({
      error: "A request about this place is already waiting",
      code: MTM_HOURS_REQUEST_PENDING,
      data: { request: waiting ? customerHoursRequestForAgent(waiting, actor.agentId) : null },
    }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer_hours_request",
    entityId: created.id,
    metadataKind: "customer_hours_request",
    newData: { customerId: customer.id, proposedHours: proposed },
    req,
  }).catch((error) => console.warn("[MTM/route-field/hours-request] audit failed", error))

  return noStoreJson({ success: true, data: { request: customerHoursRequestForAgent(created, actor.agentId) } }, { status: 201 })
}, { requiredCapability: "route-field" })

/**
 * DELETE /api/v2/mtm/mobile/route-field/organizations/:id/hours-request
 *
 * The agent takes back his own request about this place while it still waits.
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

  const waiting = await prisma.mtmCustomerHoursRequest.findFirst({
    where: { organizationId: auth.orgId, customerId, requestedByAgentId: actor.agentId, status: "SUBMITTED" },
    select: { id: true },
  })
  if (!waiting) return noStoreJson({ error: "Not found", code: MTM_HOURS_REQUEST_NOT_FOUND }, { status: 404 })
  const cancelled = await prisma.mtmCustomerHoursRequest.updateMany({
    where: { id: waiting.id, organizationId: auth.orgId, status: "SUBMITTED" },
    data: { status: "CANCELLED", reviewedAt: new Date() },
  })
  if (cancelled.count !== 1) return noStoreJson({ error: "Not found", code: MTM_HOURS_REQUEST_NOT_FOUND }, { status: 404 })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer_hours_request",
    entityId: waiting.id,
    metadataKind: "customer_hours_request",
    oldData: { status: "SUBMITTED" },
    newData: { status: "CANCELLED", customerId },
    req,
  }).catch((error) => console.warn("[MTM/route-field/hours-request] audit failed", error))

  return noStoreJson({ success: true, data: { id: waiting.id, status: "CANCELLED" } })
}, { requiredCapability: "route-field" })
