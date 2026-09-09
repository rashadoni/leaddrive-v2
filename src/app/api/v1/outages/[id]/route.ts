/**
 * R6 Energy & Utilities — outage per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — three-way handling + canTransitionOutage slice-2 wrapper
 *   (state-machine + scheduledStartAt-required-for-cancellation gate).
 *   Auto-stamps actualStartAt on `active` transition (covers
 *   `active_coherence_check`) and actualEndAt on `resolved` (covers
 *   `resolved_coherence_check`).
 *
 *   actual window invariant: actualEndAt > actualStartAt (DB CHECK
 *   `outages_actual_window_check`). Pre-validated at route layer.
 *
 * Immutable on PATCH:
 *   • outageNumber — institutional id (regulator-facing)
 *
 * DELETE NOT exposed — outages are regulator-reportable; cancellation
 * is a status transition (only valid for planned outages with
 * scheduledStartAt set).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { canTransitionOutage } from "@/lib/energy-utilities/state-machine"
import {
  OUTAGE_CAUSES,
  OUTAGE_SEVERITIES,
} from "@/lib/energy-utilities/types"
import {
  encryptForTenantOrNull,
  softDecryptForTenant,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "outages"
const MAX_SUMMARY_LEN = 5_000
const MAX_NOTES_LEN = 20_000

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseNonNegInt(
  v: unknown,
): number | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v
  return "invalid"
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing outage id" }, { status: 400 })
  }

  try {
    const outage = await prisma.outage.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!outage) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Outage not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: outage.id,
      action: "read",
      metadata: {
        outageNumber: outage.outageNumber,
        cause: outage.cause,
        severity: outage.severity,
        status: outage.status,
      },
    })

    return NextResponse.json({
      outage: {
        ...outage,
        publicSummary: softDecryptForTenant(orgId, outage.publicSummary),
        internalNotes: softDecryptForTenant(orgId, outage.internalNotes),
      },
    })
  } catch (err) {
    console.error("[outages/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load outage" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  cause?: unknown
  severity?: unknown
  scheduledStartAt?: unknown
  scheduledEndAt?: unknown
  actualStartAt?: unknown
  actualEndAt?: unknown
  affectedMeterCount?: unknown
  publicSummary?: unknown
  internalNotes?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("energy-utilities", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing outage id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.outage.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      actualStartAt: true,
      actualEndAt: true,
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
      { error: "Outage not found" },
      { status: 404 },
    )
  }

  const data: {
    cause?: string
    severity?: string
    scheduledStartAt?: Date | null
    scheduledEndAt?: Date | null
    actualStartAt?: Date | null
    actualEndAt?: Date | null
    affectedMeterCount?: number
    publicSummary?: string | null
    internalNotes?: string | null
    status?: string
    metadata?: unknown
  } = {}

  if (body.cause !== undefined) {
    if (
      typeof body.cause !== "string" ||
      !(OUTAGE_CAUSES as readonly string[]).includes(body.cause)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`cause\` — must be one of: ${OUTAGE_CAUSES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.cause = body.cause
  }
  if (body.severity !== undefined) {
    if (
      typeof body.severity !== "string" ||
      !(OUTAGE_SEVERITIES as readonly string[]).includes(body.severity)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`severity\` — must be one of: ${OUTAGE_SEVERITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.severity = body.severity
  }

  // Time windows — three-way.
  let nextScheduledStart = existing.scheduledStartAt
  let nextScheduledEnd = existing.scheduledEndAt
  let nextActualStart = existing.actualStartAt
  let nextActualEnd = existing.actualEndAt

  const parseDateField = (
    v: unknown,
    name: string,
  ):
    | { ok: true; date: Date | null | undefined }
    | { ok: false; error: string } => {
    if (v === undefined) return { ok: true, date: undefined }
    if (v === null) return { ok: true, date: null }
    if (typeof v !== "string") {
      return { ok: false, error: `Invalid \`${name}\`` }
    }
    const d = new Date(v)
    if (isNaN(d.getTime())) {
      return { ok: false, error: `Invalid \`${name}\`` }
    }
    return { ok: true, date: d }
  }

  const ss = parseDateField(body.scheduledStartAt, "scheduledStartAt")
  if (!ss.ok) return NextResponse.json({ error: ss.error }, { status: 400 })
  if (ss.date !== undefined) {
    data.scheduledStartAt = ss.date
    nextScheduledStart = ss.date
  }
  const se = parseDateField(body.scheduledEndAt, "scheduledEndAt")
  if (!se.ok) return NextResponse.json({ error: se.error }, { status: 400 })
  if (se.date !== undefined) {
    data.scheduledEndAt = se.date
    nextScheduledEnd = se.date
  }
  const as = parseDateField(body.actualStartAt, "actualStartAt")
  if (!as.ok) return NextResponse.json({ error: as.error }, { status: 400 })
  if (as.date !== undefined) {
    data.actualStartAt = as.date
    nextActualStart = as.date
  }
  const ae = parseDateField(body.actualEndAt, "actualEndAt")
  if (!ae.ok) return NextResponse.json({ error: ae.error }, { status: 400 })
  if (ae.date !== undefined) {
    data.actualEndAt = ae.date
    nextActualEnd = ae.date
  }

  // Window invariants.
  if (
    nextScheduledStart &&
    nextScheduledEnd &&
    nextScheduledEnd.getTime() <= nextScheduledStart.getTime()
  ) {
    return NextResponse.json(
      { error: "`scheduledEndAt` must be after `scheduledStartAt`" },
      { status: 400 },
    )
  }
  if (
    nextActualStart &&
    nextActualEnd &&
    nextActualEnd.getTime() <= nextActualStart.getTime()
  ) {
    return NextResponse.json(
      { error: "`actualEndAt` must be after `actualStartAt`" },
      { status: 400 },
    )
  }

  if (body.affectedMeterCount !== undefined) {
    const n = parseNonNegInt(body.affectedMeterCount)
    if (n === "invalid") {
      return NextResponse.json(
        { error: "Invalid `affectedMeterCount` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (n === null) {
      return NextResponse.json(
        { error: "`affectedMeterCount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (n !== undefined) data.affectedMeterCount = n
  }
  if (body.publicSummary !== undefined) {
    const v = strField(body.publicSummary, MAX_SUMMARY_LEN)
    // Slice-2 PII column wrap: encrypt before persisting.
    if (v !== undefined) data.publicSummary = encryptForTenantOrNull(orgId, v)
  }
  if (body.internalNotes !== undefined) {
    const v = strField(body.internalNotes, MAX_NOTES_LEN)
    if (v !== undefined) data.internalNotes = encryptForTenantOrNull(orgId, v)
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = canTransitionOutage(existing.status, body.status, {
      scheduledStartAt: nextScheduledStart,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    data.status = body.status
    const now = new Date()

    // active_coherence: status IN (active, resolved) → actualStartAt
    // NOT NULL. Auto-stamp if missing.
    if (
      (body.status === "active" || body.status === "resolved") &&
      !nextActualStart
    ) {
      data.actualStartAt = now
      nextActualStart = now
    }
    // resolved_coherence: status = resolved → actualEndAt NOT NULL.
    if (body.status === "resolved" && !nextActualEnd) {
      // Ensure actualEndAt > actualStartAt: if same instant, bump 1ms.
      const candidate =
        nextActualStart && now.getTime() <= nextActualStart.getTime()
          ? new Date(nextActualStart.getTime() + 1)
          : now
      data.actualEndAt = candidate
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
    const outage = await prisma.outage.update({
      where: { id },
      data,
      select: {
        id: true,
        outageNumber: true,
        cause: true,
        severity: true,
        status: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        actualStartAt: true,
        actualEndAt: true,
        affectedMeterCount: true,
        publicSummary: true,
        internalNotes: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set(["actualStartAt", "actualEndAt"])
    const allFields = Object.keys(data)
    // For actualStartAt/actualEndAt, only flag as auto-stamped if
    // caller didn't supply them in this PATCH.
    const callerSet = new Set<string>()
    if (body.actualStartAt !== undefined) callerSet.add("actualStartAt")
    if (body.actualEndAt !== undefined) callerSet.add("actualEndAt")
    const bodyFields = allFields.filter(
      (k) => !AUTO_STAMP_KEYS.has(k) || callerSet.has(k),
    )
    const autoStampedFields = allFields.filter(
      (k) => AUTO_STAMP_KEYS.has(k) && !callerSet.has(k),
    )

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: outage.id,
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
      outage: {
        ...outage,
        publicSummary: softDecryptForTenant(orgId, outage.publicSummary),
        internalNotes: softDecryptForTenant(orgId, outage.internalNotes),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An outage with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[outages/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update outage" },
      { status: 500 },
    )
  }
})
