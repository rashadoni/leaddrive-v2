/**
 * R7 Insurance — claim per-id (slice-2-mini).
 *
 * GET — single read + 404 audit.
 * PATCH — status transitions via slice-2 `canTransitionClaim` wrapper
 *   (PR #87) which gates `approved → under_review` un-approve reversal
 *   on `adjusterId !== null` (SIU audit-trail rule). Auto-stamps
 *   lifecycle columns AND backfills prior chronological stamps when a
 *   path skips a status (e.g. direct `reported → denied` still needs
 *   `reviewStartedAt` per DB CHECK `claims_review_coherence_check`).
 *
 * Immutable on PATCH:
 *   • claimNumber  — institutional identifier
 *   • policyId     — re-parenting a claim to a different policy
 *                     forges someone else's loss event
 *   • lossDate     — slice-1 schema says immutable, statute-of-
 *                     limitations math depends on a stable date
 *   • lossType     — affects rating engine + DOI line-of-business
 *                     reporting
 *
 * DELETE intentionally NOT exposed — insurance claims are regulatory
 * artifacts (DOI fraud-records retention); withdrawal/close goes
 * through the `closed_no_action` status.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { canTransitionClaim } from "@/lib/insurance/state-machine"
import {
  CLAIM_SEVERITIES,
  type ClaimStatus,
} from "@/lib/insurance/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD. AAD now
// includes the (TABLE, "<column>") tuple to defeat same-tenant
// cross-column ciphertext shuffle on PHI/PII fields. The PATCH
// side-exit gate for `decisionRationale` keeps its bound binding —
// shuffling a denied-claim rationale into another column would
// otherwise pass the slice-2 GCM tag check.
const TABLE = "claims"
const MAX_DESCRIPTION_LEN = 10_000

function strField(
  v: unknown,
  max: number,
): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
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

/**
 * Forward-stage rank for the timestamp backfill. Mirrors the pattern
 * in `public-sector-cases/[id]/route.ts`. Side-exit terminal statuses
 * (denied, closed_no_action) have rank 1 — they still require
 * `reviewStartedAt` per `claims_review_coherence_check` but don't
 * drive `approvedAt` / `settledAt` backfill.
 */
const STATUS_RANK: Record<ClaimStatus, number> = {
  reported: 0,
  under_review: 1,
  approved: 2,
  settled: 3,
  denied: 1,
  closed_no_action: 1,
}

export const GET = withRlsAuth("insurance", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing claim id" }, { status: 400 })
  }

  try {
    const claim = await prisma.claim.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!claim) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Claim not found" }, { status: 404 })
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: claim.id,
      action: "read",
      metadata: {
        claimNumber: claim.claimNumber,
        policyId: claim.policyId,
        status: claim.status,
        severity: claim.severity,
        fraudFlag: claim.fraudFlag,
      },
    })

    return NextResponse.json({
      claim: {
        ...claim,
        description: softDecryptForTenantBound(orgId, TABLE, "description", claim.description),
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          claim.decisionRationale,
        ),
      },
    })
  } catch (err) {
    console.error("[claims/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load claim" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  severity?: unknown
  currentReserveAmount?: unknown
  paidAmount?: unknown
  description?: unknown
  adjusterId?: unknown
  fraudFlag?: unknown
  status?: unknown
  decisionRationale?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("insurance", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing claim id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.claim.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      lossDate: true,
      adjusterId: true,
      reviewStartedAt: true,
      approvedAt: true,
      settledAt: true,
      deniedAt: true,
      closedNoActionAt: true,
      decisionRationale: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json({ error: "Claim not found" }, { status: 404 })
  }

  const data: {
    severity?: string
    currentReserveAmount?: Prisma.Decimal
    paidAmount?: Prisma.Decimal
    description?: string | null
    adjusterId?: string | null
    fraudFlag?: boolean
    status?: string
    decisionRationale?: string | null
    reviewStartedAt?: Date
    approvedAt?: Date
    settledAt?: Date
    deniedAt?: Date
    closedNoActionAt?: Date
    metadata?: unknown
  } = {}

  if (body.severity !== undefined) {
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
    data.severity = body.severity
  }

  if (body.currentReserveAmount !== undefined) {
    const v = parseDecimal(body.currentReserveAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `currentReserveAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v !== null && v !== undefined) data.currentReserveAmount = v
  }
  if (body.paidAmount !== undefined) {
    const v = parseDecimal(body.paidAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `paidAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v !== null && v !== undefined) data.paidAmount = v
  }

  if (body.description !== undefined) {
    const v = strField(body.description, MAX_DESCRIPTION_LEN)
    // Slice-2 PII column wrap: encrypt description before persisting.
    if (v !== undefined) data.description = encryptForTenantBoundOrNull(orgId, TABLE, "description", v)
  }

  // adjusterId — three-way + tenant pre-check.
  let nextAdjusterId = existing.adjusterId
  if (body.adjusterId !== undefined) {
    const v = strField(body.adjusterId, 64)
    if (v !== undefined) {
      if (v !== null) {
        const adj = await prisma.insuranceServiceTeamMember.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true },
        })
        if (!adj) {
          return NextResponse.json(
            { error: "Adjuster not found for this tenant" },
            { status: 404 },
          )
        }
      }
      data.adjusterId = v
      nextAdjusterId = v
    }
  }

  if (body.fraudFlag !== undefined) {
    if (typeof body.fraudFlag !== "boolean") {
      return NextResponse.json(
        { error: "`fraudFlag` must be boolean" },
        { status: 400 },
      )
    }
    data.fraudFlag = body.fraudFlag
  }

  // Status transition via context-aware wrapper. Approval-reversal
  // requires assigned adjuster on the *next* row (SIU audit rule);
  // the wrapper enforces this.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = canTransitionClaim(existing.status, body.status, {
      lossDate: existing.lossDate,
      adjusterId: nextAdjusterId,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Side-exit reasons required + auto-stamped. decisionRationale
    // is encrypted PII (slice-3 column-bound AAD) — wrap the supplied
    // value via encryptForTenantBoundOrNull before persisting so AAD
    // binds to (orgId, claims, decisionRationale). Audit-trail
    // fallback (existing.decisionRationale) is already encrypted, so
    // when caller doesn't supply we leave the column unchanged.
    if (body.status === "denied") {
      const rationale =
        strField(body.decisionRationale, MAX_DESCRIPTION_LEN) ??
        existing.decisionRationale
      if (!rationale) {
        return NextResponse.json(
          {
            error:
              "`decisionRationale` (non-empty string) is required when transitioning to `denied`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.decisionRationale, MAX_DESCRIPTION_LEN)
      if (supplied) {
        data.decisionRationale = encryptForTenantBoundOrNull(orgId, TABLE, "decisionRationale", supplied)
      }
    }
    if (body.status === "closed_no_action") {
      const rationale =
        strField(body.decisionRationale, MAX_DESCRIPTION_LEN) ??
        existing.decisionRationale
      if (!rationale) {
        return NextResponse.json(
          {
            error:
              "`decisionRationale` (non-empty string) is required when transitioning to `closed_no_action`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.decisionRationale, MAX_DESCRIPTION_LEN)
      if (supplied) {
        data.decisionRationale = encryptForTenantBoundOrNull(orgId, TABLE, "decisionRationale", supplied)
      }
    }

    data.status = body.status
    const now = new Date()
    const targetRank = STATUS_RANK[body.status as ClaimStatus]

    // Backfill review timestamp on any forward-from-`reported` path —
    // DB CHECK `claims_review_coherence_check` requires
    // reviewStartedAt NOT NULL for under_review/approved/settled/denied/
    // closed_no_action. Side exits (denied, closed_no_action) still
    // count.
    if (targetRank >= STATUS_RANK.under_review && !existing.reviewStartedAt) {
      data.reviewStartedAt = now
    }
    // approved + settled require approvedAt.
    if (targetRank >= STATUS_RANK.approved && !existing.approvedAt) {
      data.approvedAt = now
    }
    if (body.status === "settled" && !existing.settledAt) {
      data.settledAt = now
    }
    if (body.status === "denied" && !existing.deniedAt) {
      data.deniedAt = now
    }
    if (body.status === "closed_no_action" && !existing.closedNoActionAt) {
      data.closedNoActionAt = now
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
    // metadata-null collapses to {} (JSONB column is non-nullable).
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const claim = await prisma.claim.update({
      where: { id },
      data,
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
        reviewStartedAt: true,
        approvedAt: true,
        settledAt: true,
        deniedAt: true,
        closedNoActionAt: true,
        decisionRationale: true,
        updatedAt: true,
      },
    })

    // Split operator-supplied fields from auto-stamps for FOIA-style
    // audit clarity (mirrors PR #98 R8 cases).
    const AUTO_STAMP_KEYS = new Set([
      "reviewStartedAt",
      "approvedAt",
      "settledAt",
      "deniedAt",
      "closedNoActionAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter(k => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter(k => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: claim.id,
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
      claim: {
        ...claim,
        description: softDecryptForTenantBound(orgId, TABLE, "description", claim.description),
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          claim.decisionRationale,
        ),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`adjusterId`)" },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A claim with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[claims/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update claim" },
      { status: 500 },
    )
  }
})
