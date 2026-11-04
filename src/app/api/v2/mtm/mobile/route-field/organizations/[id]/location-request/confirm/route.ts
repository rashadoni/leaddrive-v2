import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { checkRateLimit } from "@/lib/rate-limit"
import { agentPermissionDeniedBody, agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  LOCATION_REQUEST_CONFIRMATION_ERROR,
  MTM_LOCATION_REQUEST_NOTHING_TO_CONFIRM,
  customerLocationRequestForAgent,
  evaluateLocationRequestConfirmation,
} from "@/lib/mtm/customer-location-request"

type RouteContext = { params: Promise<{ id: string }> }

const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60 * 60_000 }

const bodySchema = z.object({
  // Where the phone is, as it knows it at this moment — the whole point of a confirmation.
  agent: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(100_000),
    fixAgeSeconds: z.number().finite().min(0).max(86_400),
    isMock: z.boolean().nullable().optional(),
  }),
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
  origin: true,
  proposedAddress: true,
  confirmedAt: true,
} as const

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

/**
 * POST /api/v2/mtm/mobile/route-field/organizations/:id/location-request/confirm
 *
 * «Подтвердить: клиент здесь» (owner, 2026-11-04: «пришёл уже на правильное
 * место и подтверждает, что это был правильно предложенный адрес»). The agent
 * who proposed a customer's place in advance stands at it: his phone's fix is
 * held to the rules of «Клиент здесь» and must be at the proposed pin. Then
 * the request stands on a fix taken there — the manager reads «подтверждено
 * на месте», and visits count from the proposed place while it waits.
 *
 * Only his own advance request, only while it waits; a second confirmation is
 * the first one again. A place he is not at is refused, and he corrects it with
 * an ordinary «Клиент здесь», which replaces his advance request.
 */
export const POST = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId || actor.agentId !== auth.agentId) {
    return noStoreJson({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  const agentId = actor.agentId

  const settings = await getMtmSettings(auth.orgId)
  if (!agentPermissionEnabled(settings, "customerLocationRequest")) {
    return noStoreJson(agentPermissionDeniedBody("customerLocationRequest"), { status: 403 })
  }
  if (!checkRateLimit(`mtm-customer-location-request:${auth.orgId}:${agentId}`, WRITE_RATE_LIMIT)) {
    return noStoreJson({ error: "Too many requests", code: "MTM_LOCATION_REQUEST_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600" } })
  }

  const { id: rawId } = await params
  const customerId = rawId.trim()
  if (!customerId) return noStoreJson({ error: "Organization id is required", code: "MTM_ROUTE_FIELD_ORGANIZATION_ID_REQUIRED" }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return noStoreJson({ error: parsed.error.issues[0]?.message || "Invalid request", code: "MTM_LOCATION_REQUEST_INVALID" }, { status: 400 })
  }
  const { agent } = parsed.data
  if (normalizeMtmCoordinates(agent).latitude === null) {
    return noStoreJson({ error: "Coordinates are required", code: "MTM_LOCATION_REQUEST_INVALID" }, { status: 400 })
  }

  const waiting = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { organizationId: auth.orgId, customerId, requestedByAgentId: agentId, status: "SUBMITTED", origin: "REMOTE" },
    select: requestSelect,
  })
  if (!waiting) {
    return noStoreJson({ error: "Nothing to confirm", code: MTM_LOCATION_REQUEST_NOTHING_TO_CONFIRM }, { status: 404 })
  }
  // A second tap, or a lost answer: it is confirmed, and stays confirmed as it was.
  if (waiting.confirmedAt) {
    return noStoreJson({ success: true, data: { request: customerLocationRequestForAgent(waiting, agentId) }, idempotent: true })
  }

  const now = new Date()
  const verdict = evaluateLocationRequestConfirmation(waiting, agent, now)
  if (!verdict.ok) {
    return noStoreJson({
      error: "The confirmation cannot be taken",
      code: LOCATION_REQUEST_CONFIRMATION_ERROR[verdict.problem],
      details: verdict.details,
    }, { status: 422 })
  }

  // Only while it still waits unconfirmed: a manager's answer that landed a moment ago stands.
  const confirmed = await prisma.mtmCustomerLocationRequest.updateMany({
    where: { id: waiting.id, organizationId: auth.orgId, status: "SUBMITTED", confirmedAt: null },
    data: verdict.facts,
  })
  const current = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { id: waiting.id, organizationId: auth.orgId },
    select: requestSelect,
  })
  if (confirmed.count !== 1) {
    if (current?.status === "SUBMITTED" && current.confirmedAt) {
      return noStoreJson({ success: true, data: { request: customerLocationRequestForAgent(current, agentId) }, idempotent: true })
    }
    return noStoreJson({ error: "Nothing to confirm", code: MTM_LOCATION_REQUEST_NOTHING_TO_CONFIRM }, { status: 404 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_LOCATION_REQUEST,
    entity: "customer_location_request",
    entityId: waiting.id,
    metadataKind: "customer_location_request",
    oldData: { confirmedAt: null },
    newData: {
      customerId,
      confirmedOnSite: true,
      confirmToProposedMeters: verdict.facts.confirmToProposedMeters,
      confirmAccuracyMeters: Math.round(verdict.facts.confirmAccuracyMeters),
    },
    req,
  }).catch((error) => console.warn("[MTM/route-field/location-request/confirm] audit failed", error))

  return noStoreJson({ success: true, data: { request: current ? customerLocationRequestForAgent(current, agentId) : null } })
}, { requiredCapability: "route-field" })
