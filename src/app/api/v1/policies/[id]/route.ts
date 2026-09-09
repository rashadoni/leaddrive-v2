/**
 * R7 Insurance — policy per-id (slice-2-mini).
 *
 * GET — single policy read, audited as PII.
 * PATCH — status transitions via `transitionPolicy` slice-1 helper.
 *   Auto-stamps lifecycle columns: boundAt / activatedAt / expiredAt /
 *   lapsedAt / cancelledAt.
 *
 * Immutable on PATCH:
 *   • policyNumber  — institutional identifier; if it changes it's a
 *                      different policy
 *   • policyHolderId — re-parenting changes the legal contract;
 *                      a new policy must be issued instead
 *   • lineOfBusiness — affects rating engine + DOI reporting; not
 *                      hot-swappable
 *
 * DELETE intentionally NOT exposed — insurance contracts are
 * regulatory artifacts; cancellation is a status transition.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionPolicy } from "@/lib/insurance/state-machine"
import { BILLING_FREQUENCIES } from "@/lib/insurance/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the
// single PII column on this route — `cancellationReason` is a free-text
// audit-trail field tied to the cancelled-policy state transition.
// Binding AAD to (orgId, policies, cancellationReason) means a same-
// tenant shuffle of a cancellation rationale into another column on
// the same policy would fail GCM verification.
const TABLE = "policies"
const MAX_GENERIC_LEN = 200

function strField(
  v: unknown,
  max: number = MAX_GENERIC_LEN,
): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  // Both number and string paths share the same precision check —
  // the DB is Decimal(18,2) and the route is the rejection boundary.
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
  if (dot !== -1 && raw.length - dot - 1 > 2) {
    return "invalid"
  }
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

export const GET = withRlsAuth("insurance", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing policy id" }, { status: 400 })
  }

  try {
    const policy = await prisma.policy.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!policy) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Policy not found" }, { status: 404 })
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: policy.id,
      action: "read",
      metadata: {
        policyNumber: policy.policyNumber,
        status: policy.status,
        lineOfBusiness: policy.lineOfBusiness,
        policyHolderId: policy.policyHolderId,
      },
    })

    return NextResponse.json({
      policy: {
        ...policy,
        cancellationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "cancellationReason",
          policy.cancellationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[policies/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load policy" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  coverageLimit?: unknown
  deductible?: unknown
  annualPremium?: unknown
  billingFrequency?: unknown
  effectiveDate?: unknown
  expirationDate?: unknown
  underwriterId?: unknown
  status?: unknown
  cancellationReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("insurance", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing policy id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.policy.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      effectiveDate: true,
      expirationDate: true,
      boundAt: true,
      activatedAt: true,
      expiredAt: true,
      lapsedAt: true,
      cancelledAt: true,
      cancellationReason: true,
    },
  })
  if (!existing) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 })
  }

  const data: {
    coverageLimit?: Prisma.Decimal
    deductible?: Prisma.Decimal | null
    annualPremium?: Prisma.Decimal
    billingFrequency?: string
    effectiveDate?: Date | null
    expirationDate?: Date | null
    underwriterId?: string | null
    status?: string
    cancellationReason?: string | null
    boundAt?: Date
    activatedAt?: Date
    expiredAt?: Date
    lapsedAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  if (body.coverageLimit !== undefined) {
    const v = parseDecimal(body.coverageLimit)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `coverageLimit` (must be non-negative number)" },
        { status: 400 },
      )
    }
    if (v !== null && v !== undefined) data.coverageLimit = v
  }
  if (body.annualPremium !== undefined) {
    const v = parseDecimal(body.annualPremium)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `annualPremium` (must be non-negative number)" },
        { status: 400 },
      )
    }
    if (v !== null && v !== undefined) data.annualPremium = v
  }
  if (body.deductible !== undefined) {
    const v = parseDecimal(body.deductible)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `deductible` (must be non-negative number)" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.deductible = v // allow null (clear)
  }

  if (body.billingFrequency !== undefined) {
    if (
      typeof body.billingFrequency !== "string" ||
      !(BILLING_FREQUENCIES as readonly string[]).includes(body.billingFrequency)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`billingFrequency\` — must be one of: ${BILLING_FREQUENCIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.billingFrequency = body.billingFrequency
  }

  // Coverage-window edits — both sides three-way: undefined=skip,
  // null=clear, string=set.
  let nextEffective = existing.effectiveDate
  let nextExpiration = existing.expirationDate
  if (body.effectiveDate !== undefined) {
    if (body.effectiveDate === null) {
      data.effectiveDate = null
      nextEffective = null
    } else if (typeof body.effectiveDate === "string") {
      const d = new Date(body.effectiveDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `effectiveDate`" },
          { status: 400 },
        )
      }
      data.effectiveDate = d
      nextEffective = d
    } else {
      return NextResponse.json(
        { error: "Invalid `effectiveDate`" },
        { status: 400 },
      )
    }
  }
  if (body.expirationDate !== undefined) {
    if (body.expirationDate === null) {
      data.expirationDate = null
      nextExpiration = null
    } else if (typeof body.expirationDate === "string") {
      const d = new Date(body.expirationDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `expirationDate`" },
          { status: 400 },
        )
      }
      data.expirationDate = d
      nextExpiration = d
    } else {
      return NextResponse.json(
        { error: "Invalid `expirationDate`" },
        { status: 400 },
      )
    }
  }
  if (
    (body.effectiveDate !== undefined || body.expirationDate !== undefined) &&
    nextEffective &&
    nextExpiration &&
    nextExpiration.getTime() <= nextEffective.getTime()
  ) {
    return NextResponse.json(
      { error: "`expirationDate` must be after `effectiveDate`" },
      { status: 400 },
    )
  }

  // underwriterId — three-way, FK validated.
  if (body.underwriterId !== undefined) {
    const v = strField(body.underwriterId, 64)
    if (v !== undefined) {
      if (v !== null) {
        const u = await prisma.insuranceServiceTeamMember.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true },
        })
        if (!u) {
          return NextResponse.json(
            { error: "Underwriter not found for this tenant" },
            { status: 404 },
          )
        }
      }
      data.underwriterId = v
    }
  }

  // Status transition + lifecycle stamping + cancellation reason.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionPolicy(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    if (body.status === "cancelled") {
      const reason =
        strField(body.cancellationReason) ?? existing.cancellationReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`cancellationReason` (non-empty string) is required when transitioning to `cancelled`",
          },
          { status: 400 },
        )
      }
      // Only persist if caller supplied; otherwise reuse existing column.
      const supplied = strField(body.cancellationReason)
      // Slice-2 PII column wrap: encrypt cancellation reason before
      // persisting.
      if (supplied) {
        data.cancellationReason = encryptForTenantBoundOrNull(orgId, TABLE, "cancellationReason", supplied)
      }
    }
    // DB CHECK `policies_active_coherence_check` requires
    //   status IN (active, expired, lapsed) ⇒ effectiveDate IS NOT NULL.
    // Surface as a 400 instead of a constraint-violation 500.
    if (
      body.status === "active" ||
      body.status === "expired" ||
      body.status === "lapsed"
    ) {
      const effective = nextEffective
      if (!effective) {
        return NextResponse.json(
          {
            error: `\`effectiveDate\` must be set before transitioning to \`${body.status}\``,
          },
          { status: 400 },
        )
      }
    }
    data.status = body.status
    const now = new Date()
    // DB CHECK `policies_bound_coherence_check` requires
    //   status IN (bound, active, expired, lapsed, cancelled) ⇒
    //   boundAt IS NOT NULL. So a direct `quote → cancelled` (legal in
    //   POLICY_TRANSITIONS) MUST also backfill `boundAt`. Backfill
    //   uniformly on any exit from `quote`, not just the obvious
    //   `quote → bound` path.
    const exitingQuote = existing.status === "quote" && body.status !== "quote"
    if (exitingQuote && !existing.boundAt) data.boundAt = now
    if (body.status === "bound" && !existing.boundAt) data.boundAt = now
    if (body.status === "active" && !existing.activatedAt) {
      data.activatedAt = now
    }
    if (body.status === "expired" && !existing.expiredAt) {
      data.expiredAt = now
    }
    if (body.status === "lapsed" && !existing.lapsedAt) {
      data.lapsedAt = now
    }
    if (body.status === "cancelled" && !existing.cancelledAt) {
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
    const policy = await prisma.policy.update({
      where: { id },
      data,
      select: {
        id: true,
        policyNumber: true,
        policyHolderId: true,
        lineOfBusiness: true,
        status: true,
        coverageLimit: true,
        annualPremium: true,
        deductible: true,
        billingFrequency: true,
        effectiveDate: true,
        expirationDate: true,
        underwriterId: true,
        boundAt: true,
        activatedAt: true,
        expiredAt: true,
        lapsedAt: true,
        cancelledAt: true,
        cancellationReason: true,
        updatedAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: policy.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      policy: {
        ...policy,
        cancellationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "cancellationReason",
          policy.cancellationReason,
        ),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`underwriterId`)" },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A policy with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[policies/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update policy" },
      { status: 500 },
    )
  }
})
