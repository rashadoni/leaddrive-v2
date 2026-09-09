/**
 * R7 Insurance — beneficiary roster / create (slice-2-mini).
 *
 * Fifteenth route-layer consumer. Beneficiaries are per-policy nested
 * rows; PII heavy (legal name, dateOfBirth, taxId). Every read/write
 * audits via `recordPiiAccessFromRequest`.
 *
 * Slice-1 `validateBeneficiaries` (set-level: primary-tier sum, life-
 * line invariant) is the source of truth — but it operates on the
 * FULL set for a policy. Slice-2-mini POST/PATCH runs the set-level
 * validation inside a serializable transaction (pre-fetch existing
 * set, apply the simulated change, validate the merged result, then
 * commit). Race window between transactions is closed by Postgres
 * SERIALIZABLE isolation; slice-3 may add an advisory lock for hot
 * policies.
 */
import { NextResponse } from "next/server"
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

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD. AAD now
// binds to (orgId, beneficiaries, "<column>"). Soft-decrypt fallback
// chain handles slice-2 ciphertext + pre-wrap plaintext rows in DB.
const TABLE = "beneficiaries"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200

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

function parseDecimal(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
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

export const GET = withRlsAuth("insurance", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const policyId = searchParams.get("policyId")
  const tier = searchParams.get("tier")
  const includeRevokedRaw = searchParams.get("includeRevoked")
  // Slice-3 blind-index equality search. Caller passes the plaintext
  // legal name; we HMAC it with the per-tenant blind-index key and
  // filter on the indexed `fullNameBlindIndex` column. Substring search
  // is intentionally not supported (HMAC has no locality) — exact match
  // only. Legacy rows without a blind-index value won't match this
  // filter until backfill completes.
  const fullNameFilter = searchParams.get("fullName")
  // Slice-3 ext: same shape for taxId. Claims-adjuster workflow
  // reconciles a beneficiary against the payee SSN — exact-match
  // lookup is the common path.
  const taxIdFilter = searchParams.get("taxId")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    policyId?: string
    tier?: string
    revokedAt?: null
    fullNameBlindIndex?: string
    taxIdBlindIndex?: string
  } = { organizationId: orgId }
  if (policyId) where.policyId = policyId
  if (tier) where.tier = tier
  if (includeRevokedRaw !== "true") {
    where.revokedAt = null
  }
  if (fullNameFilter && fullNameFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter && taxIdFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where,
      orderBy: [{ designatedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        createdAt: true,
      },
    })
    const hasMore = beneficiaries.length > limit
    const rawRows = hasMore ? beneficiaries.slice(0, limit) : beneficiaries
    // Soft-decrypt encrypted PII columns. The list selects only
    // fullName + relationship from the wrapped set.
    const rows = rawRows.map(
      (b: { fullName: string; relationship: string | null } & Record<string, unknown>) => ({
        ...b,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", b.fullName),
        relationship: softDecryptForTenantBound(orgId, TABLE, "relationship", b.relationship),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        policyId: policyId ?? null,
        tier: tier ?? null,
        includeRevoked: includeRevokedRaw === "true",
        // Audit trail records whether the caller filtered by name —
        // the plaintext itself is never logged.
        fullNameFilterHit:
          fullNameFilter !== null && fullNameFilter.trim().length > 0,
        taxIdFilterHit:
          taxIdFilter !== null && taxIdFilter.trim().length > 0,
        rowCount: rows.length,
      },
    })

    const response = NextResponse.json({ beneficiaries: rows, hasMore, nextCursor })
    // Deprecation signal (RFC 8594): plaintext PII in URL query params
    // is logged by nginx access log. Callers should migrate to
    // POST /api/v1/beneficiaries/lookup which keeps PII in the body.
    if (
      (fullNameFilter && fullNameFilter.trim().length > 0) ||
      (taxIdFilter && taxIdFilter.trim().length > 0)
    ) {
      response.headers.set("Deprecation", "true")
      response.headers.set(
        "Link",
        "</api/v1/beneficiaries/lookup>; rel=\"successor-version\"",
      )
    }
    return response
  } catch (err) {
    console.error("[beneficiaries] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load beneficiaries" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  policyId?: unknown
  tier?: unknown
  beneficiaryType?: unknown
  fullName?: unknown
  relationship?: unknown
  allocationPct?: unknown
  taxId?: unknown
  dateOfBirth?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("insurance", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const policyId = trimOrNull(body.policyId, 64)
  if (!policyId) {
    return NextResponse.json(
      { error: "`policyId` is required" },
      { status: 400 },
    )
  }
  const fullName = trimOrNull(body.fullName, MAX_NAME_LEN)
  if (!fullName) {
    return NextResponse.json(
      { error: "`fullName` is required" },
      { status: 400 },
    )
  }
  let tier: string = "primary"
  if (body.tier !== undefined && body.tier !== null) {
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
    tier = body.tier
  }
  let beneficiaryType: string = "person"
  if (body.beneficiaryType !== undefined && body.beneficiaryType !== null) {
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
    beneficiaryType = body.beneficiaryType
  }

  const allocationPct = parseDecimal(body.allocationPct)
  if (allocationPct === "invalid" || allocationPct === null) {
    return NextResponse.json(
      { error: "`allocationPct` is required (0..100, ≤ 2dp)" },
      { status: 400 },
    )
  }

  const dateOfBirth = parseDate(body.dateOfBirth)
  if (dateOfBirth === "invalid") {
    return NextResponse.json(
      { error: "Invalid `dateOfBirth`" },
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
    // Set-level validation + insert inside one transaction.
    // SERIALIZABLE isolation closes the race window where two
    // concurrent POSTs could each pass validation and sum to >100.
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Verify policy + tenant + look up lineOfBusiness.
        const policy = await tx.policy.findFirst({
          where: { id: policyId, organizationId: orgId },
          select: { id: true, lineOfBusiness: true },
        })
        if (!policy) {
          return {
            error: "Policy not found for this tenant",
            status: 404,
          } as const
        }

        // Fetch existing set for set-level validation.
        const existing = await tx.beneficiary.findMany({
          where: { policyId: policy.id, organizationId: orgId },
          select: {
            id: true,
            tier: true,
            beneficiaryType: true,
            allocationPct: true,
            revokedAt: true,
          },
        })
        const simulated: BeneficiaryAllocation[] = [
          ...existing.map((b: { id: string; tier: string; beneficiaryType: string; allocationPct: Prisma.Decimal; revokedAt: Date | null }) => ({
            id: b.id,
            tier: b.tier as BeneficiaryAllocation["tier"],
            beneficiaryType:
              b.beneficiaryType as BeneficiaryAllocation["beneficiaryType"],
            allocationPct: Number(b.allocationPct),
            revokedAt: b.revokedAt,
          })),
          {
            // New row gets a placeholder id; will be replaced by cuid()
            // on actual insert. validateBeneficiaries doesn't care
            // about persistent ids — just uniqueness within the set.
            id: `__pending_${Date.now()}`,
            tier: tier as BeneficiaryAllocation["tier"],
            beneficiaryType:
              beneficiaryType as BeneficiaryAllocation["beneficiaryType"],
            allocationPct: allocationPct,
            revokedAt: null,
          },
        ]
        const v = validateBeneficiaries({
          beneficiaries: simulated,
          isLifeLine: policy.lineOfBusiness === "life",
        })
        if (!v.ok) {
          return {
            error: `Beneficiary allocation invalid: ${v.error}`,
            status: 400,
          } as const
        }

        // Slice-2 PII column wrap: encrypt PHI/PII columns at the
        // route boundary. fullName / taxId are sensitive; relationship
        // less so but still personal — wrapped for consistency.
        // Slice-3 blind-index: stamp HMAC of normalized fullName so the
        // listing route can support equality search without plaintext.
        // Slice-3 ext: same for taxId — compute plaintext once, then
        // both encrypt + hash from the same value.
        const plainTaxId = trimOrNull(body.taxId, 64)
        const beneficiary = await tx.beneficiary.create({
          data: {
            organizationId: orgId,
            policyId: policy.id,
            tier,
            beneficiaryType,
            fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
            fullNameBlindIndex: blindIndexForTenant(orgId, fullName),
            relationship: encryptForTenantBoundOrNull(
              orgId,
              TABLE,
              "relationship",
              trimOrNull(body.relationship, 100),
            ),
            allocationPct: new Prisma.Decimal(allocationPct.toFixed(2)),
            taxId: encryptForTenantBoundOrNull(orgId, TABLE, "taxId", plainTaxId),
            taxIdBlindIndex: blindIndexForTenant(orgId, plainTaxId),
            dateOfBirth,
            metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            policyId: true,
            tier: true,
            beneficiaryType: true,
            fullName: true,
            allocationPct: true,
            designatedAt: true,
            createdAt: true,
          },
        })
        return { beneficiary } as const
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: result.beneficiary.id,
      action: "write",
      metadata: {
        policyId: result.beneficiary.policyId,
        tier: result.beneficiary.tier,
        beneficiaryType: result.beneficiary.beneficiaryType,
      },
    })

    return NextResponse.json(
      {
        beneficiary: {
          ...result.beneficiary,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", result.beneficiary.fullName),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid foreign key (`policyId`)" },
        { status: 400 },
      )
    }
    console.error("[beneficiaries] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create beneficiary" },
      { status: 500 },
    )
  }
})
