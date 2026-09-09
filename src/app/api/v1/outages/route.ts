/**
 * R6 Energy & Utilities — outage roster / create (slice-2-mini).
 *
 * Twenty-second route-layer consumer. Outage records drive
 * regulator-facing reliability KPIs (SAIDI/SAIFI); operator audit
 * via `recordPiiAccessFromRequest`.
 *
 * Status lifecycle (slice-2 `canTransitionOutage` wrapper):
 *   pending → active | cancelled
 *   active → resolved
 *   resolved/cancelled — terminal
 *
 * canTransitionOutage gates cancellation: `to: 'cancelled'` requires
 * `scheduledStartAt NOT NULL` because cancellation only makes sense
 * for planned outages — unplanned outages must be marked `resolved`,
 * not cancelled. DB CHECK `outages_cancelled_coherence_check` enforces
 * the same invariant; the slice-2 wrapper raises it to a friendly 400.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { createNotification } from "@/lib/notifications"
import {
  OUTAGE_CAUSES,
  OUTAGE_SEVERITIES,
} from "@/lib/energy-utilities/types"
import { encryptForTenantOrNull } from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "outages"
const MAX_PAGE_SIZE = 200
const MAX_SUMMARY_LEN = 5_000
const MAX_NOTES_LEN = 20_000

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

function parseNonNegInt(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v
  return "invalid"
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const cause = searchParams.get("cause")
  const severity = searchParams.get("severity")
  const fromRaw = searchParams.get("startedFrom")
  const toRaw = searchParams.get("startedTo")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    cause?: string
    severity?: string
    actualStartAt?: { gte?: Date; lte?: Date }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (cause) where.cause = cause
  if (severity) where.severity = severity
  if (fromRaw || toRaw) {
    const range: { gte?: Date; lte?: Date } = {}
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `startedFrom`" },
          { status: 400 },
        )
      }
      range.gte = d
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `startedTo`" },
          { status: 400 },
        )
      }
      range.lte = d
    }
    where.actualStartAt = range
  }

  try {
    const outages = await prisma.outage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        createdAt: true,
      },
    })
    const hasMore = outages.length > limit
    const rows = hasMore ? outages.slice(0, limit) : outages
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        cause: cause ?? null,
        severity: severity ?? null,
        windowed: !!(fromRaw || toRaw),
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ outages: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[outages] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load outages" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  outageNumber?: unknown
  cause?: unknown
  severity?: unknown
  scheduledStartAt?: unknown
  scheduledEndAt?: unknown
  affectedMeterCount?: unknown
  publicSummary?: unknown
  internalNotes?: unknown
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

  const outageNumber = trimOrNull(body.outageNumber, 64)
  if (!outageNumber) {
    return NextResponse.json(
      { error: "`outageNumber` is required" },
      { status: 400 },
    )
  }

  let cause: string = "unknown"
  if (body.cause !== undefined && body.cause !== null) {
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
    cause = body.cause
  }
  let severity: string = "minor"
  if (body.severity !== undefined && body.severity !== null) {
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
    severity = body.severity
  }

  const scheduledStartAt = parseDate(body.scheduledStartAt)
  if (scheduledStartAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `scheduledStartAt`" },
      { status: 400 },
    )
  }
  const scheduledEndAt = parseDate(body.scheduledEndAt)
  if (scheduledEndAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `scheduledEndAt`" },
      { status: 400 },
    )
  }
  if (
    scheduledStartAt &&
    scheduledEndAt &&
    scheduledEndAt.getTime() <= scheduledStartAt.getTime()
  ) {
    return NextResponse.json(
      { error: "`scheduledEndAt` must be after `scheduledStartAt`" },
      { status: 400 },
    )
  }

  const affectedMeterCount = parseNonNegInt(body.affectedMeterCount ?? 0)
  if (affectedMeterCount === "invalid") {
    return NextResponse.json(
      { error: "Invalid `affectedMeterCount` (non-negative integer)" },
      { status: 400 },
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
    const outage = await prisma.outage.create({
      data: {
        organizationId: orgId,
        outageNumber,
        cause,
        severity,
        scheduledStartAt,
        scheduledEndAt,
        affectedMeterCount: affectedMeterCount ?? 0,
        // Slice-2 PII column wrap: outage notes may include affected
        // customer addresses or vendor-IP-confidential info. Encrypt.
        publicSummary: encryptForTenantOrNull(
          orgId,
          trimOrNull(body.publicSummary, MAX_SUMMARY_LEN),
        ),
        internalNotes: encryptForTenantOrNull(
          orgId,
          trimOrNull(body.internalNotes, MAX_NOTES_LEN),
        ),
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        outageNumber: true,
        cause: true,
        severity: true,
        status: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        affectedMeterCount: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: outage.id,
      action: "write",
      metadata: {
        outageNumber: outage.outageNumber,
        cause: outage.cause,
        severity: outage.severity,
      },
    })

    // Phase 2d notification — org-wide in-app only, PII-safe (no customer data in message).
    // type "warning" — outage requires operational response.
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "warning",
      title: "Outage reported",
      message: "A new outage has been reported",
      entityType: "outage",
      entityId: outage.id,
      kind: "outage.reported",
    }).catch(() => {})

    return NextResponse.json({ outage }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An outage with this `outageNumber` already exists" },
        { status: 409 },
      )
    }
    console.error("[outages] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create outage" },
      { status: 500 },
    )
  }
})
