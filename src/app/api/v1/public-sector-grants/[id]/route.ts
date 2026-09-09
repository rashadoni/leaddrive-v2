/**
 * R8 Public Sector — grant per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (FOIA).
 * PATCH — status transitions via slice-1 `transitionGrant` helper.
 *   STATUS_RANK drives forward-stamp backfill for reviewStartedAt /
 *   approvedAt / disbursingStartedAt. Coherence enforced at the route
 *   layer rather than letting Postgres throw 500:
 *     • → approved | disbursing | disbursed | cancelled
 *         requires `approvedAmount` set (DB CHECK approved_coherence)
 *     • → disbursed requires `disbursedAmount = approvedAmount`
 *         (DB CHECK disbursed_coherence — full disbursement only)
 *     • → denied requires `decisionRationale`
 *     • → withdrawn | cancelled requires `terminationReason`
 *     • disbursedAmount ≤ approvedAmount always (DB CHECK
 *       disbursement_bound)
 *
 * Immutable on PATCH (de-facto + by-design):
 *   • grantNumber  — institutional identifier
 *   • programSlug  — drives funding-source allocation
 *   • requestedAmount — set at submission; once approval workflow
 *                     starts the requested amount can't change
 *                     (a new grant is filed instead)
 *   • citizenId    — re-parenting to a different citizen forges
 *                     someone else's grant application
 *   • caseId       — parent-case link is set at submission; once
 *                     processing starts it can't be rerouted to a
 *                     different statutory deadline
 *
 * DELETE intentionally NOT exposed — FOIA + audit retention.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionGrant } from "@/lib/public-sector/state-machine"
import { type GrantStatus } from "@/lib/public-sector/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the 3
// PII text columns — narrative (PATCH write), decisionRationale
// (PATCH side-exit gate on `denied`/`approved` decisions),
// terminationReason (PATCH side-exit gate on `terminated`/`withdrawn`).
// AAD binds to (orgId, public_sector_grants, "<column>") — defeats
// FOIA-relevant text shuffle across the same grant's audit trail.
const TABLE = "public_sector_grants"
const MAX_NARRATIVE_LEN = 20_000

function strField(v: unknown, max: number): string | null | undefined {
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
 * Forward-progression rank for the timestamp backfill.
 *   submitted    = 0
 *   under_review = 1 (reviewStartedAt)
 *   approved     = 2 (approvedAt + approvedAmount)
 *   disbursing   = 3 (disbursingStartedAt)
 *   disbursed    = 4 (disbursedAt + disbursedAmount = approvedAmount)
 * Side-exit ranks reflect which earlier stamps are required by the
 * coherence CHECKs:
 *   denied     — must have reviewStartedAt (rank 1)
 *   withdrawn  — terminal from submitted or under_review (rank 0;
 *                doesn't pull review back)
 *   cancelled  — only legal from approved or disbursing → must have
 *                approvedAt + approvedAmount (rank 2)
 */
const STATUS_RANK: Record<GrantStatus, number> = {
  submitted: 0,
  under_review: 1,
  approved: 2,
  disbursing: 3,
  disbursed: 4,
  denied: 1,
  withdrawn: 0,
  cancelled: 2,
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing grant id" }, { status: 400 })
  }

  try {
    const grant = await prisma.publicSectorGrant.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!grant) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Grant not found" }, { status: 404 })
    }

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: grant.id,
      action: "read",
      metadata: {
        grantNumber: grant.grantNumber,
        programSlug: grant.programSlug,
        status: grant.status,
        citizenId: grant.citizenId,
        caseId: grant.caseId,
      },
    })

    return NextResponse.json({
      grant: {
        ...grant,
        narrative: softDecryptForTenantBound(orgId, TABLE, "narrative", grant.narrative),
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          grant.decisionRationale,
        ),
        terminationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "terminationReason",
          grant.terminationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[public-sector-grants/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load grant" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  approvedAmount?: unknown
  disbursedAmount?: unknown
  assignedOfficialId?: unknown
  narrative?: unknown
  status?: unknown
  decisionRationale?: unknown
  terminationReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("public-sector", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing grant id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.publicSectorGrant.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      approvedAmount: true,
      disbursedAmount: true,
      reviewStartedAt: true,
      approvedAt: true,
      disbursingStartedAt: true,
      disbursedAt: true,
      deniedAt: true,
      withdrawnAt: true,
      cancelledAt: true,
      decisionRationale: true,
      terminationReason: true,
    },
  })
  if (!existing) {
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json({ error: "Grant not found" }, { status: 404 })
  }

  const data: {
    approvedAmount?: Prisma.Decimal
    disbursedAmount?: Prisma.Decimal
    assignedOfficialId?: string | null
    narrative?: string | null
    status?: string
    decisionRationale?: string | null
    terminationReason?: string | null
    reviewStartedAt?: Date
    approvedAt?: Date
    disbursingStartedAt?: Date
    disbursedAt?: Date
    deniedAt?: Date
    withdrawnAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  // approvedAmount + disbursedAmount — both Decimal, non-negative.
  let nextApprovedAmount: Prisma.Decimal | null = existing.approvedAmount
  if (body.approvedAmount !== undefined) {
    const v = parseDecimal(body.approvedAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `approvedAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        {
          error:
            "`approvedAmount` cannot be cleared once the workflow has approved a value",
        },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      data.approvedAmount = v
      nextApprovedAmount = v
    }
  }
  let nextDisbursedAmount: Prisma.Decimal = existing.disbursedAmount
  if (body.disbursedAmount !== undefined) {
    const v = parseDecimal(body.disbursedAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `disbursedAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`disbursedAmount` cannot be cleared (column is non-nullable)" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      data.disbursedAmount = v
      nextDisbursedAmount = v
    }
  }
  // Disbursement-bound CHECK: disbursedAmount ≤ approvedAmount.
  if (
    nextApprovedAmount !== null &&
    nextDisbursedAmount.greaterThan(nextApprovedAmount)
  ) {
    return NextResponse.json(
      {
        error: "`disbursedAmount` cannot exceed `approvedAmount`",
      },
      { status: 400 },
    )
  }

  // assignedOfficialId — three-way + tenant pre-check.
  if (body.assignedOfficialId !== undefined) {
    const v = strField(body.assignedOfficialId, 64)
    if (v !== undefined) {
      if (v !== null) {
        const off = await prisma.publicSectorOfficial.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true },
        })
        if (!off) {
          return NextResponse.json(
            { error: "Official not found for this tenant" },
            { status: 404 },
          )
        }
      }
      data.assignedOfficialId = v
    }
  }

  if (body.narrative !== undefined) {
    const v = strField(body.narrative, MAX_NARRATIVE_LEN)
    // Slice-2 PII column wrap: encrypt narrative before persisting.
    if (v !== undefined) data.narrative = encryptForTenantBoundOrNull(orgId, TABLE, "narrative", v)
  }

  // Status transition + coherence gates + stamps.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionGrant(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    const target = body.status as GrantStatus
    const targetRank = STATUS_RANK[target]

    // Approval coherence: approved/disbursing/disbursed/cancelled
    // require approvedAmount NOT NULL.
    const requiresApprovedAmount =
      target === "approved" ||
      target === "disbursing" ||
      target === "disbursed" ||
      target === "cancelled"
    if (requiresApprovedAmount && !nextApprovedAmount) {
      return NextResponse.json(
        {
          error: `\`approvedAmount\` must be set before transitioning to \`${body.status}\``,
        },
        { status: 400 },
      )
    }

    // Disbursed coherence: disbursedAmount must equal approvedAmount.
    if (
      target === "disbursed" &&
      (!nextApprovedAmount ||
        !nextDisbursedAmount.equals(nextApprovedAmount))
    ) {
      return NextResponse.json(
        {
          error:
            "`disbursedAmount` must equal `approvedAmount` before transitioning to `disbursed` (full disbursement only)",
        },
        { status: 400 },
      )
    }

    // Side-exit reason fields.
    if (target === "denied") {
      const rationale =
        strField(body.decisionRationale, MAX_NARRATIVE_LEN) ??
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
      const supplied = strField(body.decisionRationale, MAX_NARRATIVE_LEN)
      // Slice-2 PII column wrap: encrypt before persisting.
      if (supplied) {
        data.decisionRationale = encryptForTenantBoundOrNull(orgId, TABLE, "decisionRationale", supplied)
      }
    }
    if (target === "withdrawn" || target === "cancelled") {
      const reason =
        strField(body.terminationReason, MAX_NARRATIVE_LEN) ??
        existing.terminationReason
      if (!reason) {
        return NextResponse.json(
          {
            error: `\`terminationReason\` (non-empty string) is required when transitioning to \`${target}\``,
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.terminationReason, MAX_NARRATIVE_LEN)
      if (supplied) {
        data.terminationReason = encryptForTenantBoundOrNull(orgId, TABLE, "terminationReason", supplied)
      }
    }

    data.status = body.status
    const now = new Date()

    // Forward-progress backfill.
    if (
      targetRank >= STATUS_RANK.under_review &&
      !existing.reviewStartedAt
    ) {
      data.reviewStartedAt = now
    }
    if (
      (targetRank >= STATUS_RANK.approved || target === "cancelled") &&
      !existing.approvedAt
    ) {
      data.approvedAt = now
    }
    if (
      targetRank >= STATUS_RANK.disbursing &&
      !existing.disbursingStartedAt
    ) {
      data.disbursingStartedAt = now
    }
    if (target === "disbursed" && !existing.disbursedAt) {
      data.disbursedAt = now
    }
    if (target === "denied" && !existing.deniedAt) {
      data.deniedAt = now
    }
    if (target === "withdrawn" && !existing.withdrawnAt) {
      data.withdrawnAt = now
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
    const grant = await prisma.publicSectorGrant.update({
      where: { id },
      data,
      select: {
        id: true,
        grantNumber: true,
        programSlug: true,
        status: true,
        citizenId: true,
        caseId: true,
        assignedOfficialId: true,
        requestedAmount: true,
        approvedAmount: true,
        disbursedAmount: true,
        currency: true,
        submittedAt: true,
        reviewStartedAt: true,
        approvedAt: true,
        disbursingStartedAt: true,
        disbursedAt: true,
        deniedAt: true,
        withdrawnAt: true,
        cancelledAt: true,
        decisionRationale: true,
        terminationReason: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "reviewStartedAt",
      "approvedAt",
      "disbursingStartedAt",
      "disbursedAt",
      "deniedAt",
      "withdrawnAt",
      "cancelledAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter(k => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter(k => AUTO_STAMP_KEYS.has(k))

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: grant.id,
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
      grant: {
        ...grant,
        narrative: softDecryptForTenantBound(orgId, TABLE, "narrative", grant.narrative),
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          grant.decisionRationale,
        ),
        terminationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "terminationReason",
          grant.terminationReason,
        ),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`assignedOfficialId`)" },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A grant with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[public-sector-grants/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update grant" },
      { status: 500 },
    )
  }
})
