/**
 * R7 Insurance — claim roster / create (slice-2-mini).
 *
 * Eighth route-layer consumer of the compliance-audit primitives.
 * Mirrors PR #97 R7 policies — claim writes are PII-adjacent (per-row
 * accountability + payout disbursement audit; state DOI inspectors
 * subpoena claim-access logs for fraud cases).
 *
 * Status lifecycle (slice-1 `transitionClaim` + slice-2
 * `canTransitionClaim`):
 *   reported → under_review → approved → settled
 *   approved → under_review        (un-approve, adjuster-gated)
 *   under_review → denied | closed_no_action  (rationale required)
 *
 * Decimal-money discipline (same as policies): initialReserveAmount,
 * currentReserveAmount, paidAmount are Decimal(18,2). Route accepts
 * JSON number OR string, rejects Infinity/NaN/>2dp/negative at the
 * boundary — DB never sees over-precision values.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { createNotification } from "@/lib/notifications"
import {
  CLAIM_LOSS_TYPES,
  CLAIM_SEVERITIES,
} from "@/lib/insurance/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD.
const TABLE = "claims"
const MAX_PAGE_SIZE = 200
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

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

export const GET = withRlsAuth("insurance", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const lossType = searchParams.get("lossType")
  const severity = searchParams.get("severity")
  const policyId = searchParams.get("policyId")
  const adjusterId = searchParams.get("adjusterId")
  const fraudFlagRaw = searchParams.get("fraudFlag")
  const claimNumberSearch = searchParams.get("claimNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    lossType?: string
    severity?: string
    policyId?: string
    adjusterId?: string
    fraudFlag?: boolean
    claimNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (lossType) where.lossType = lossType
  if (severity) where.severity = severity
  if (policyId) where.policyId = policyId
  if (adjusterId) where.adjusterId = adjusterId
  if (fraudFlagRaw !== null) {
    if (fraudFlagRaw === "true") where.fraudFlag = true
    else if (fraudFlagRaw === "false") where.fraudFlag = false
    // anything else: silently ignore (don't 400 on a UI quirk)
  }
  if (claimNumberSearch && claimNumberSearch.length > 0) {
    where.claimNumber = { contains: claimNumberSearch, mode: "insensitive" }
  }

  try {
    const claims = await prisma.claim.findMany({
      where,
      orderBy: [{ reportedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        claimNumber: true,
        policyId: true,
        lossType: true,
        status: true,
        severity: true,
        lossDate: true,
        reportedAt: true,
        initialReserveAmount: true,
        currentReserveAmount: true,
        paidAmount: true,
        adjusterId: true,
        fraudFlag: true,
        approvedAt: true,
        settledAt: true,
        deniedAt: true,
        closedNoActionAt: true,
        createdAt: true,
      },
    })
    const hasMore = claims.length > limit
    const rows = hasMore ? claims.slice(0, limit) : claims
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        lossType: lossType ?? null,
        severity: severity ?? null,
        policyId: policyId ?? null,
        adjusterId: adjusterId ?? null,
        fraudFlag: fraudFlagRaw === "true" || fraudFlagRaw === "false"
          ? fraudFlagRaw
          : null,
        searchHit:
          claimNumberSearch !== null && claimNumberSearch.length > 0,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ claims: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[claims] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load claims" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  claimNumber?: unknown
  policyId?: unknown
  lossType?: unknown
  severity?: unknown
  lossDate?: unknown
  initialReserveAmount?: unknown
  description?: unknown
  adjusterId?: unknown
  fraudFlag?: unknown
}

export const POST = withRlsAuth("insurance", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const claimNumber = trimOrNull(body.claimNumber, 64)
  if (!claimNumber) {
    return NextResponse.json(
      { error: "`claimNumber` is required" },
      { status: 400 },
    )
  }
  const policyId = trimOrNull(body.policyId, 64)
  if (!policyId) {
    return NextResponse.json(
      { error: "`policyId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.lossType !== "string" ||
    !(CLAIM_LOSS_TYPES as readonly string[]).includes(body.lossType)
  ) {
    return NextResponse.json(
      {
        error: `\`lossType\` is required and must be one of: ${CLAIM_LOSS_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const lossType = body.lossType

  const lossDate = parseDate(body.lossDate)
  if (lossDate === "invalid" || lossDate === null) {
    return NextResponse.json(
      { error: "Valid `lossDate` (ISO datetime) is required" },
      { status: 400 },
    )
  }
  // DB CHECK `claims_loss_before_reported_check`: lossDate <= reportedAt.
  // reportedAt defaults to now(); reject obviously-future lossDate here.
  if (lossDate.getTime() > Date.now()) {
    return NextResponse.json(
      { error: "`lossDate` cannot be in the future" },
      { status: 400 },
    )
  }

  let severity: string = "minor"
  if (body.severity !== undefined && body.severity !== null) {
    if (
      typeof body.severity !== "string" ||
      !(CLAIM_SEVERITIES as readonly string[]).includes(body.severity)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`severity\` — must be one of: ${CLAIM_SEVERITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    severity = body.severity
  }

  const initialReserveAmount = parseDecimal(body.initialReserveAmount ?? 0)
  if (initialReserveAmount === "invalid") {
    return NextResponse.json(
      { error: "Invalid `initialReserveAmount` (non-negative, ≤ 2dp)" },
      { status: 400 },
    )
  }

  let fraudFlag = false
  if (body.fraudFlag !== undefined && body.fraudFlag !== null) {
    if (typeof body.fraudFlag !== "boolean") {
      return NextResponse.json(
        { error: "`fraudFlag` must be boolean" },
        { status: 400 },
      )
    }
    fraudFlag = body.fraudFlag
  }

  // Tenant pre-check on policy. adjuster optional + verified iff set.
  const policyCheck = await prisma.policy.findFirst({
    where: { id: policyId, organizationId: orgId },
    select: { id: true },
  })
  if (!policyCheck) {
    return NextResponse.json(
      { error: "Policy not found for this tenant" },
      { status: 404 },
    )
  }

  const adjusterId = trimOrNull(body.adjusterId, 64)
  if (adjusterId) {
    const adj = await prisma.insuranceServiceTeamMember.findFirst({
      where: { id: adjusterId, organizationId: orgId },
      select: { id: true },
    })
    if (!adj) {
      return NextResponse.json(
        { error: "Adjuster not found for this tenant" },
        { status: 404 },
      )
    }
  }

  try {
    const claim = await prisma.claim.create({
      data: {
        organizationId: orgId,
        claimNumber,
        policyId,
        lossType,
        severity,
        lossDate,
        initialReserveAmount:
          initialReserveAmount ?? new Prisma.Decimal(0),
        currentReserveAmount:
          initialReserveAmount ?? new Prisma.Decimal(0),
        // Slice-2 PII column wrap: free-text description may contain
        // SIU-sensitive details (witness names, addresses, incident
        // specifics). Encrypt at the route boundary.
        description: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "description",
          trimOrNull(body.description, MAX_DESCRIPTION_LEN),
        ),
        adjusterId,
        fraudFlag,
      },
      select: {
        id: true,
        claimNumber: true,
        policyId: true,
        lossType: true,
        severity: true,
        status: true,
        lossDate: true,
        reportedAt: true,
        initialReserveAmount: true,
        currentReserveAmount: true,
        paidAmount: true,
        adjusterId: true,
        fraudFlag: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: claim.id,
      action: "write",
      metadata: {
        claimNumber: claim.claimNumber,
        policyId: claim.policyId,
        lossType: claim.lossType,
        severity: claim.severity,
        fraudFlag: claim.fraudFlag,
      },
    })

    // Phase 2d notification — org-wide in-app only, PII-safe (no PII in title/message).
    // type "warning" — claim filing requires adjuster action.
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "warning",
      title: "New claim filed",
      message: "A new insurance claim has been filed",
      entityType: "claim",
      entityId: claim.id,
      kind: "claim.filed",
    }).catch(() => {})

    return NextResponse.json({ claim }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A claim with this `claimNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`policyId` / `adjusterId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[claims] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create claim" },
      { status: 500 },
    )
  }
})
