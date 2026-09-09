/**
 * R7 Insurance — beneficiary per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — three-way handling. Set-level allocation validation
 *   re-runs inside a SERIALIZABLE transaction when tier or
 *   allocationPct change, ensuring race-free correctness across
 *   concurrent edits.
 *
 *   Revocation: set `revokedAt = <ISO>` + supply `revocationReason`.
 *   Validator skips revoked rows, so revoking a primary on a life
 *   policy that brings primary-tier sum below 100 will be flagged.
 *
 * Immutable on PATCH:
 *   • policyId — re-parenting a beneficiary to a different policy
 *               forges legal designation
 *
 * DELETE NOT exposed — beneficiaries are legal-document rows; use
 * revocation (revokedAt + revocationReason) instead.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  BENEFICIARY_TIERS,
  BENEFICIARY_TYPES,
  type BeneficiaryAllocation,
} from "@/lib/insurance/types"
import { validateBeneficiaries } from "@/lib/insurance/beneficiary-allocation-validator"
import {
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
  blindIndexForTenant,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the four
// PII columns — fullName (required), relationship, taxId,
// revocationReason (PATCH side-exit gate). See `route.ts` header
// comment for full rationale + fallback-chain rollout safety.
const TABLE = "beneficiaries"
const MAX_NAME_LEN = 200

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDecimal(v: unknown): number | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0 || v > 100) return "invalid"
    return v
  }
  if (typeof v === "string") {
    const trimmed = v.trim()
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return "invalid"
    const dot = trimmed.indexOf(".")
    if (dot !== -1 && trimmed.length - dot - 1 > 2) return "invalid"
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0 || n > 100) return "invalid"
    return n
  }
  return "invalid"
}

export const GET = withRlsAuth("insurance", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing beneficiary id" },
      { status: 400 },
    )
  }

  try {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!beneficiary) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Beneficiary not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: beneficiary.id,
      action: "read",
      metadata: {
        policyId: beneficiary.policyId,
        tier: beneficiary.tier,
        beneficiaryType: beneficiary.beneficiaryType,
        revoked: beneficiary.revokedAt !== null,
      },
    })

    // Soft-decrypt encrypted PII columns.
    return NextResponse.json({
      beneficiary: {
        ...beneficiary,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", beneficiary.fullName),
        relationship: softDecryptForTenantBound(orgId, TABLE, "relationship", beneficiary.relationship),
        taxId: softDecryptForTenantBound(orgId, TABLE, "taxId", beneficiary.taxId),
        revocationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "revocationReason",
          beneficiary.revocationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[beneficiaries/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load beneficiary" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  tier?: unknown
  beneficiaryType?: unknown
  fullName?: unknown
  relationship?: unknown
  allocationPct?: unknown
  taxId?: unknown
  dateOfBirth?: unknown
  revokedAt?: unknown
  revocationReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("insurance", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing beneficiary id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Build the change-set up front (pre-validate everything except
  // the set-level invariant).
  const data: {
    tier?: string
    beneficiaryType?: string
    fullName?: string
    fullNameBlindIndex?: string | null
    relationship?: string | null
    allocationPct?: Prisma.Decimal
    taxId?: string | null
    taxIdBlindIndex?: string | null
    dateOfBirth?: Date | null
    revokedAt?: Date | null
    revocationReason?: string | null
    metadata?: unknown
  } = {}

  if (body.tier !== undefined) {
    if (
      typeof body.tier !== "string" ||
      !(BENEFICIARY_TIERS as readonly string[]).includes(body.tier)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`tier\` — must be one of: ${BENEFICIARY_TIERS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.tier = body.tier
  }
  if (body.beneficiaryType !== undefined) {
    if (
      typeof body.beneficiaryType !== "string" ||
      !(BENEFICIARY_TYPES as readonly string[]).includes(body.beneficiaryType)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`beneficiaryType\` — must be one of: ${BENEFICIARY_TYPES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.beneficiaryType = body.beneficiaryType
  }
  // Slice-2 PII column wrap: encrypt fullName / relationship / taxId
  // before persisting via slice-3 column-bound AAD helpers. Required
  // `fullName` uses encryptForTenantBound; nullable optional fields
  // (relationship, taxId, revocationReason) use encryptForTenantBoundOrNull
  // with the (TABLE, "<column>") tuple.
  if (body.fullName !== undefined) {
    const v = strField(body.fullName, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`fullName` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.fullName = encryptForTenantBound(orgId, TABLE, "fullName", v)
    // Slice-3 blind-index: re-stamp the HMAC alongside the ciphertext
    // so equality search keeps working after a rename. Same key, same
    // normalization as POST.
    data.fullNameBlindIndex = blindIndexForTenant(orgId, v)
  }
  if (body.relationship !== undefined) {
    const v = strField(body.relationship, 100)
    if (v !== undefined) data.relationship = encryptForTenantBoundOrNull(orgId, TABLE, "relationship", v)
  }
  if (body.taxId !== undefined) {
    const v = strField(body.taxId, 64)
    if (v !== undefined) {
      data.taxId = encryptForTenantBoundOrNull(orgId, TABLE, "taxId", v)
      // Slice-3 ext: re-compute blind-index in lockstep with the
      // ciphertext write so GET-list `?taxId=` finds the row.
      data.taxIdBlindIndex = blindIndexForTenant(orgId, v)
    }
  }
  if (body.allocationPct !== undefined) {
    const n = parseDecimal(body.allocationPct)
    if (n === "invalid" || n === null) {
      return NextResponse.json(
        { error: "Invalid `allocationPct` (0..100, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (n !== undefined) {
      data.allocationPct = new Prisma.Decimal(n.toFixed(2))
    }
  }
  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null) {
      data.dateOfBirth = null
    } else if (typeof body.dateOfBirth === "string") {
      const d = new Date(body.dateOfBirth)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `dateOfBirth`" },
          { status: 400 },
        )
      }
      data.dateOfBirth = d
    } else {
      return NextResponse.json(
        { error: "Invalid `dateOfBirth`" },
        { status: 400 },
      )
    }
  }
  // Revocation: revokedAt three-way. If revoking, require revocationReason.
  if (body.revokedAt !== undefined) {
    if (body.revokedAt === null) {
      data.revokedAt = null
    } else if (typeof body.revokedAt === "string") {
      const d = new Date(body.revokedAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `revokedAt`" },
          { status: 400 },
        )
      }
      data.revokedAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `revokedAt`" },
        { status: 400 },
      )
    }
  }
  if (body.revocationReason !== undefined) {
    const v = strField(body.revocationReason, 1000)
    // Slice-2 PII column wrap: revocation reason carries reason text
    // (often family-relationship narrative) — encrypt before persisting.
    if (v !== undefined) {
      data.revocationReason = encryptForTenantBoundOrNull(orgId, TABLE, "revocationReason", v)
    }
  }
  if (data.revokedAt !== undefined && data.revokedAt !== null) {
    // Revoking — require revocationReason.
    if (!data.revocationReason) {
      return NextResponse.json(
        {
          error:
            "`revocationReason` (non-empty string) is required when setting `revokedAt`",
        },
        { status: 400 },
      )
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
    // SERIALIZABLE transaction: re-fetch the policy + sibling set
    // and re-run set-level validation against the proposed change.
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const existing = await tx.beneficiary.findFirst({
          where: { id, organizationId: orgId },
          select: {
            id: true,
            policyId: true,
            tier: true,
            beneficiaryType: true,
            allocationPct: true,
            revokedAt: true,
          },
        })
        if (!existing) {
          return {
            error: "Beneficiary not found",
            status: 404,
          } as const
        }

        // If a set-level field changed, re-validate.
        const setLevelChange =
          data.tier !== undefined ||
          data.allocationPct !== undefined ||
          data.revokedAt !== undefined ||
          data.beneficiaryType !== undefined
        if (setLevelChange) {
          const policy = await tx.policy.findFirst({
            where: { id: existing.policyId },
            select: { lineOfBusiness: true },
          })
          if (!policy) {
            return {
              error: "Parent policy not found",
              status: 404,
            } as const
          }
          const siblings = await tx.beneficiary.findMany({
            where: {
              policyId: existing.policyId,
              organizationId: orgId,
              NOT: { id: existing.id },
            },
            select: {
              id: true,
              tier: true,
              beneficiaryType: true,
              allocationPct: true,
              revokedAt: true,
            },
          })
          const merged: BeneficiaryAllocation[] = [
            ...siblings.map((s: { id: string; tier: string; beneficiaryType: string; allocationPct: Prisma.Decimal; revokedAt: Date | null }) => ({
              id: s.id,
              tier: s.tier as BeneficiaryAllocation["tier"],
              beneficiaryType:
                s.beneficiaryType as BeneficiaryAllocation["beneficiaryType"],
              allocationPct: Number(s.allocationPct),
              revokedAt: s.revokedAt,
            })),
            {
              id: existing.id,
              tier: (data.tier ??
                existing.tier) as BeneficiaryAllocation["tier"],
              beneficiaryType: (data.beneficiaryType ??
                existing.beneficiaryType) as BeneficiaryAllocation["beneficiaryType"],
              allocationPct: data.allocationPct
                ? Number(data.allocationPct)
                : Number(existing.allocationPct),
              revokedAt:
                data.revokedAt !== undefined
                  ? data.revokedAt
                  : existing.revokedAt,
            },
          ]
          const v = validateBeneficiaries({
            beneficiaries: merged,
            isLifeLine: policy.lineOfBusiness === "life",
          })
          if (!v.ok) {
            return {
              error: `Beneficiary allocation invalid: ${v.error}`,
              status: 400,
            } as const
          }
        }

        const beneficiary = await tx.beneficiary.update({
          where: { id: existing.id },
          data: data as Prisma.BeneficiaryUpdateInput,
          select: {
            id: true,
            policyId: true,
            tier: true,
            beneficiaryType: true,
            fullName: true,
            relationship: true,
            allocationPct: true,
            dateOfBirth: true,
            designatedAt: true,
            revokedAt: true,
            revocationReason: true,
            updatedAt: true,
          },
        })
        return { beneficiary } as const
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    if ("error" in result) {
      // PATCH 404 audit.
      if (result.status === 404) {
        void recordPiiAccessFromRequest(req, auth, {
          recordTable: TABLE,
          recordId: id,
          action: "write",
          metadata: { result: "not_found" },
        })
      }
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: result.beneficiary.id,
      action: "write",
      metadata: { fields: Object.keys(data) },
    })

    return NextResponse.json({
      beneficiary: {
        ...result.beneficiary,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", result.beneficiary.fullName),
        relationship: softDecryptForTenantBound(
          orgId,
          TABLE,
          "relationship",
          result.beneficiary.relationship,
        ),
        revocationReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "revocationReason",
          result.beneficiary.revocationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[beneficiaries/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update beneficiary" },
      { status: 500 },
    )
  }
})
