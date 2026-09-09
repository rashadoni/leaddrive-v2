/**
 * R6 Energy & Utilities — service call per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — three-way handling + transitionServiceCall slice-1 helper.
 *   STATUS_RANK forward-stamp backfill for dispatchedAt /
 *   startedAt (per dispatched_coherence / started_coherence DB CHECKs).
 *   Auto-stamps resolvedAt / cancelledAt. cancellation requires
 *   cancellationReason.
 *
 * Immutable on PATCH:
 *   • callNumber — institutional id
 *   • callType   — affects routing/queue allocation; new call needed
 *                   for a different type
 *
 * DELETE NOT exposed — service calls are audit-trail rows.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionServiceCall } from "@/lib/energy-utilities/state-machine"
import {
  SERVICE_CALL_PRIORITIES,
  type ServiceCallStatus,
} from "@/lib/energy-utilities/types"
import {
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 extras PR-1 (2026-05-29): column-bound AAD on 4
// PII columns — subject + description (PATCH write paths) +
// cancellationReason (PATCH side-exit gate on `cancelled`) +
// resolutionNotes (PATCH side-exit gate on `resolved`).
const TABLE = "service_calls"
const MAX_SUBJECT_LEN = 500
const MAX_DESCRIPTION_LEN = 10_000

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

const STATUS_RANK: Record<ServiceCallStatus, number> = {
  received: 0,
  dispatched: 1,
  in_progress: 2,
  resolved: 3,
  cancelled: 0,
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing service call id" },
      { status: 400 },
    )
  }

  try {
    const call = await prisma.serviceCall.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!call) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Service call not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: call.id,
      action: "read",
      metadata: {
        callNumber: call.callNumber,
        callType: call.callType,
        priority: call.priority,
        status: call.status,
        utilityCustomerId: call.utilityCustomerId,
      },
    })

    return NextResponse.json({
      call: {
        ...call,
        subject: softDecryptForTenantBound(orgId, TABLE, "subject", call.subject),
        description: softDecryptForTenantBound(orgId, TABLE, "description", call.description),
        resolutionNotes: softDecryptForTenantBound(orgId, TABLE, "resolutionNotes", call.resolutionNotes),
        cancellationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "cancellationReason",
          call.cancellationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[service-calls/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load service call" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  priority?: unknown
  subject?: unknown
  description?: unknown
  queueSlug?: unknown
  assignedToUserId?: unknown
  scheduledAt?: unknown
  status?: unknown
  cancellationReason?: unknown
  resolutionNotes?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("energy-utilities", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing service call id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.serviceCall.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      dispatchedAt: true,
      startedAt: true,
      resolvedAt: true,
      cancelledAt: true,
      cancellationReason: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Service call not found" },
      { status: 404 },
    )
  }

  const data: {
    priority?: string
    subject?: string
    description?: string | null
    queueSlug?: string | null
    assignedToUserId?: string | null
    scheduledAt?: Date | null
    status?: string
    cancellationReason?: string | null
    resolutionNotes?: string | null
    dispatchedAt?: Date
    startedAt?: Date
    resolvedAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  if (body.priority !== undefined) {
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
    data.priority = body.priority
  }
  if (body.subject !== undefined) {
    const v = strField(body.subject, MAX_SUBJECT_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`subject` cannot be cleared once set" },
        { status: 400 },
      )
    }
    // Slice-2 PII column wrap: encrypt subject before persisting.
    data.subject = encryptForTenantBound(orgId, TABLE, "subject", v)
  }
  if (body.description !== undefined) {
    const v = strField(body.description, MAX_DESCRIPTION_LEN)
    // Slice-2 PII column wrap: encrypt description before persisting.
    if (v !== undefined) data.description = encryptForTenantBoundOrNull(orgId, TABLE, "description", v)
  }
  if (body.queueSlug !== undefined) {
    const v = strField(body.queueSlug, 64)
    if (v !== undefined) data.queueSlug = v
  }
  if (body.assignedToUserId !== undefined) {
    const v = strField(body.assignedToUserId, 64)
    if (v !== undefined) data.assignedToUserId = v
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) {
      data.scheduledAt = null
    } else if (typeof body.scheduledAt === "string") {
      const d = new Date(body.scheduledAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `scheduledAt`" },
          { status: 400 },
        )
      }
      data.scheduledAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `scheduledAt`" },
        { status: 400 },
      )
    }
  }
  if (body.resolutionNotes !== undefined) {
    const v = strField(body.resolutionNotes, MAX_DESCRIPTION_LEN)
    // Slice-2 PII column wrap: encrypt resolution notes before persisting.
    if (v !== undefined) {
      data.resolutionNotes = encryptForTenantBoundOrNull(orgId, TABLE, "resolutionNotes", v)
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionServiceCall(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }

    if (body.status === "cancelled") {
      const reason =
        strField(body.cancellationReason, MAX_DESCRIPTION_LEN) ??
        existing.cancellationReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`cancellationReason` (non-empty string) is required when transitioning to `cancelled`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.cancellationReason, MAX_DESCRIPTION_LEN)
      // Slice-2 PII column wrap: encrypt cancellation reason before persisting.
      if (supplied) {
        data.cancellationReason = encryptForTenantBoundOrNull(orgId, TABLE, "cancellationReason", supplied)
      }
    }

    data.status = body.status
    const now = new Date()
    const target = body.status as ServiceCallStatus
    const targetRank = STATUS_RANK[target]

    // dispatched_coherence: status IN (dispatched, in_progress,
    // resolved) → dispatchedAt NOT NULL. Backfill.
    if (
      targetRank >= STATUS_RANK.dispatched &&
      target !== "cancelled" &&
      !existing.dispatchedAt
    ) {
      data.dispatchedAt = now
    }
    // started_coherence: status IN (in_progress, resolved) →
    // startedAt NOT NULL. Backfill.
    if (
      targetRank >= STATUS_RANK.in_progress &&
      target !== "cancelled" &&
      !existing.startedAt
    ) {
      data.startedAt = now
    }
    if (target === "resolved" && !existing.resolvedAt) {
      data.resolvedAt = now
    }
    if (target === "cancelled" && !existing.cancelledAt) {
      data.cancelledAt = now
    }
  }

  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const call = await prisma.serviceCall.update({
      where: { id },
      data,
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
        cancellationReason: true,
        resolutionNotes: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "dispatchedAt",
      "startedAt",
      "resolvedAt",
      "cancelledAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: call.id,
      action: "write",
      metadata: {
        bodyFields,
        autoStampedFields:
          autoStampedFields.length > 0 ? autoStampedFields : undefined,
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      call: {
        ...call,
        subject: softDecryptForTenantBound(orgId, TABLE, "subject", call.subject),
        description: softDecryptForTenantBound(orgId, TABLE, "description", call.description),
        resolutionNotes: softDecryptForTenantBound(orgId, TABLE, "resolutionNotes", call.resolutionNotes),
        cancellationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "cancellationReason",
          call.cancellationReason,
        ),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A service call with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[service-calls/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update service call" },
      { status: 500 },
    )
  }
})
