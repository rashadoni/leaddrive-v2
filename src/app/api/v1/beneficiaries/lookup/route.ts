/**
 * R7 Insurance — beneficiary PII-safe lookup (slice-3 security ext).
 *
 * POST /api/v1/beneficiaries/lookup
 *
 * Accepts `fullName` and/or `taxId` in the **request body** rather
 * than URL query params. Claims-adjuster workflows that reconcile a
 * beneficiary against the payee SSN would otherwise leak the SSN into
 * nginx access logs.
 *
 * At least one of `fullName` or `taxId` must be provided.
 *
 * The optional `policyId`, `tier`, and `includeRevoked` body fields
 * narrow the result set exactly as the equivalent GET query params do.
 *
 * Response shape is identical to GET /api/v1/beneficiaries.
 *
 * Auth: `insurance:read` — same as GET /api/v1/beneficiaries.
 * Audit: one PII compliance_audit_log row per call,
 *   `metadata.lookup: true` as forensic discriminator.
 *   Cursor value is NOT logged (logged as `cursorPresent: bool` only).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  blindIndexForTenant,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on read.
import { strField, parseLimit } from "@/lib/api/pii-lookup-utils"

const TABLE = "beneficiaries"

interface LookupBody {
  fullName?: unknown
  taxId?: unknown
  policyId?: unknown
  tier?: unknown
  includeRevoked?: unknown
  limit?: unknown
  cursor?: unknown
}

export const POST = withRlsAuth("insurance", "read", async (req, auth) => {
  const orgId = auth.orgId

  let body: LookupBody
  try {
    body = (await req.json()) as LookupBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const fullNameFilter = strField(body.fullName)
  const taxIdFilter = strField(body.taxId, 64)

  if (!fullNameFilter && !taxIdFilter) {
    return NextResponse.json(
      {
        error:
          "At least one of `fullName` or `taxId` is required. " +
          "For an un-filtered list use GET /api/v1/beneficiaries.",
      },
      { status: 400 },
    )
  }

  const limit = parseLimit(body.limit)
  const cursor = strField(body.cursor, 256)
  const policyId = strField(body.policyId, 64)
  const tier = strField(body.tier, 32)
  // Accept both boolean `true` and the string `"true"` so that clients
  // serialising query params as strings don't silently fall through to
  // the default-exclude-revoked behaviour.
  const includeRevoked =
    body.includeRevoked === true || body.includeRevoked === "true"

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
  if (!includeRevoked) where.revokedAt = null

  if (fullNameFilter) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter) {
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
        lookup: true,
        limit,
        cursorPresent: cursor !== null,
        policyId: policyId ?? null,
        tier: tier ?? null,
        includeRevoked,
        fullNameFilterHit: fullNameFilter !== null,
        taxIdFilterHit: taxIdFilter !== null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ beneficiaries: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[beneficiaries/lookup] POST error:", err)
    return NextResponse.json(
      { error: "Failed to look up beneficiaries" },
      { status: 500 },
    )
  }
})
