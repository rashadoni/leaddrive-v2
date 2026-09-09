/**
 * R6 Energy & Utilities — service call roster / create (slice-2-mini).
 *
 * Twenty-third route-layer consumer. Service calls aggregate customer
 * complaints, outage reports, and field-tech dispatches; carry PII via
 * linked customer rows + assignedToUserId.
 *
 * Status lifecycle (slice-1 `transitionServiceCall` helper):
 *   received → dispatched → in_progress → resolved
 *   any → cancelled (terminal; requires cancellationReason)
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  SERVICE_CALL_TYPES,
  SERVICE_CALL_PRIORITIES,
} from "@/lib/energy-utilities/types"
import {
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 extras PR-1 (2026-05-29): column-bound AAD on the
// 2 PII columns on the create path — `subject` (required) and
// `description` (optional). Other PII (cancellationReason on cancel,
// resolutionNotes on resolved) lives in `[id]/route.ts`. AAD binds
// to (orgId, service_calls, "<column>").
const TABLE = "service_calls"
const MAX_PAGE_SIZE = 200
const MAX_SUBJECT_LEN = 500
const MAX_DESCRIPTION_LEN = 10_000

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const callType = searchParams.get("callType")
  const priority = searchParams.get("priority")
  const utilityCustomerId = searchParams.get("utilityCustomerId")
  const outageId = searchParams.get("outageId")
  const queueSlug = searchParams.get("queueSlug")
  const assignedToUserId = searchParams.get("assignedToUserId")
  const callNumberSearch = searchParams.get("callNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    callType?: string
    priority?: string
    utilityCustomerId?: string
    outageId?: string
    queueSlug?: string
    assignedToUserId?: string
    callNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (callType) where.callType = callType
  if (priority) where.priority = priority
  if (utilityCustomerId) where.utilityCustomerId = utilityCustomerId
  if (outageId) where.outageId = outageId
  if (queueSlug) where.queueSlug = queueSlug
  if (assignedToUserId) where.assignedToUserId = assignedToUserId
  if (callNumberSearch && callNumberSearch.length >= 2) {
    where.callNumber = {
      contains: callNumberSearch,
      mode: "insensitive",
    }
  }

  try {
    const calls = await prisma.serviceCall.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        callNumber: true,
        utilityCustomerId: true,
        meteringPointId: true,
        outageId: true,
        callType: true,
        priority: true,
        status: true,
        subject: true,
        queueSlug: true,
        assignedToUserId: true,
        scheduledAt: true,
        dispatchedAt: true,
        startedAt: true,
        resolvedAt: true,
        cancelledAt: true,
        createdAt: true,
      },
    })
    const hasMore = calls.length > limit
    const rows = hasMore ? calls.slice(0, limit) : calls
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        callType: callType ?? null,
        priority: priority ?? null,
        utilityCustomerId: utilityCustomerId ?? null,
        outageId: outageId ?? null,
        queueSlug: queueSlug ?? null,
        assignedToUserId: assignedToUserId ?? null,
        searchHit: callNumberSearch !== null && callNumberSearch.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ calls: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[service-calls] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load service calls" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  callNumber?: unknown
  utilityCustomerId?: unknown
  meteringPointId?: unknown
  outageId?: unknown
  callType?: unknown
  priority?: unknown
  subject?: unknown
  description?: unknown
  queueSlug?: unknown
  assignedToUserId?: unknown
  scheduledAt?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("energy-utilities", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const callNumber = trimOrNull(body.callNumber, 64)
  if (!callNumber) {
    return NextResponse.json(
      { error: "`callNumber` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.callType !== "string" ||
    !(SERVICE_CALL_TYPES as readonly string[]).includes(body.callType)
  ) {
    return NextResponse.json(
      {
        error: `\`callType\` is required and must be one of: ${SERVICE_CALL_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const callType = body.callType
  const subject = trimOrNull(body.subject, MAX_SUBJECT_LEN)
  if (!subject) {
    return NextResponse.json(
      { error: "`subject` is required" },
      { status: 400 },
    )
  }

  let priority: string = "routine"
  if (body.priority !== undefined && body.priority !== null) {
    if (
      typeof body.priority !== "string" ||
      !(SERVICE_CALL_PRIORITIES as readonly string[]).includes(body.priority)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`priority\` — must be one of: ${SERVICE_CALL_PRIORITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    priority = body.priority
  }

  const scheduledAt = parseDate(body.scheduledAt)
  if (scheduledAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `scheduledAt`" },
      { status: 400 },
    )
  }

  const utilityCustomerId = trimOrNull(body.utilityCustomerId, 64)
  const meteringPointId = trimOrNull(body.meteringPointId, 64)
  const outageId = trimOrNull(body.outageId, 64)

  // Tenant pre-check on optional FK targets (parallel).
  const [customerCheck, meterCheck, outageCheck] = await Promise.all([
    utilityCustomerId
      ? prisma.utilityCustomer.findFirst({
          where: { id: utilityCustomerId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
    meteringPointId
      ? prisma.meteringPoint.findFirst({
          where: { id: meteringPointId, organizationId: orgId },
          select: { id: true, utilityCustomerId: true },
        })
      : Promise.resolve(null),
    outageId
      ? prisma.outage.findFirst({
          where: { id: outageId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (utilityCustomerId && !customerCheck) {
    return NextResponse.json(
      { error: "Utility customer not found for this tenant" },
      { status: 404 },
    )
  }
  if (meteringPointId && !meterCheck) {
    return NextResponse.json(
      { error: "Metering point not found for this tenant" },
      { status: 404 },
    )
  }
  // Cross-ref: if both customer + meter supplied, meter must belong
  // to the same customer.
  if (
    utilityCustomerId &&
    meterCheck &&
    meterCheck.utilityCustomerId !== utilityCustomerId
  ) {
    return NextResponse.json(
      {
        error:
          "`meteringPointId` does not belong to supplied `utilityCustomerId`",
      },
      { status: 400 },
    )
  }
  if (outageId && !outageCheck) {
    return NextResponse.json(
      { error: "Outage not found for this tenant" },
      { status: 404 },
    )
  }

  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const call = await prisma.serviceCall.create({
      data: {
        organizationId: orgId,
        callNumber,
        utilityCustomerId,
        meteringPointId,
        outageId,
        callType,
        priority,
        // Slice-2 PII column wrap: subject + description are caller-
        // text PII — encrypted at the route boundary.
        subject: encryptForTenantBound(orgId, TABLE, "subject", subject),
        description: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "description",
          trimOrNull(body.description, MAX_DESCRIPTION_LEN),
        ),
        queueSlug: trimOrNull(body.queueSlug, 64),
        assignedToUserId: trimOrNull(body.assignedToUserId, 64),
        scheduledAt,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        callNumber: true,
        utilityCustomerId: true,
        meteringPointId: true,
        outageId: true,
        callType: true,
        priority: true,
        status: true,
        subject: true,
        scheduledAt: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: call.id,
      action: "write",
      metadata: {
        callNumber: call.callNumber,
        callType: call.callType,
        priority: call.priority,
        utilityCustomerId: call.utilityCustomerId,
        outageId: call.outageId,
      },
    })

    return NextResponse.json({ call }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A service call with this `callNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          {
            error:
              "Invalid foreign key (`utilityCustomerId` / `meteringPointId` / `outageId`)",
          },
          { status: 400 },
        )
      }
    }
    console.error("[service-calls] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create service call" },
      { status: 500 },
    )
  }
})
