/**
 * R7 Insurance — policy-holder PII-safe lookup (slice-3 security ext).
 *
 * POST /api/v1/policy-holders/lookup
 *
 * Accepts `fullName` and/or `taxId` in the **request body** rather
 * than URL query params. State DOI / NAIC records-request workflows
 * often query by SSN; this keeps plaintext off the nginx access log.
 *
 * At least one of `fullName` or `taxId` must be provided.
 *
 * Response shape is identical to GET /api/v1/policy-holders.
 *
 * Auth: `insurance:read` — same as GET /api/v1/policy-holders.
 * Audit: one PII compliance_audit_log row per call,
 *   `metadata.lookup: true` as forensic discriminator.
 *   Cursor value is NOT logged (logged as `cursorPresent: bool` only).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  blindIndexForTenant,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
import { strField, parseLimit } from "@/lib/api/pii-lookup-utils"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on read.
const TABLE = "policy_holders"

interface LookupBody {
  fullName?: unknown
  taxId?: unknown
  status?: unknown
  search?: unknown
  limit?: unknown
  cursor?: unknown
}

export const POST = withRlsAuth("insurance", "read", async (req: NextRequest, auth) => {
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
          "For an un-filtered list use GET /api/v1/policy-holders.",
      },
      { status: 400 },
    )
  }

  const limit = parseLimit(body.limit)
  const cursor = strField(body.cursor, 256)
  const status = strField(body.status, 64)
  const search = strField(body.search)

  const where: {
    organizationId: string
    status?: string
    fullNameBlindIndex?: string
    taxIdBlindIndex?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }

  if (status) where.status = status

  if (fullNameFilter) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }

  // Legacy token search on non-PII columns (holderNumber + email).
  if (search) {
    where.OR = [
      { holderNumber: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const holders = await prisma.policyHolder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        holderNumber: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        activatedAt: true,
        createdAt: true,
      },
    })
    const hasMore = holders.length > limit
    const rawRows = hasMore ? holders.slice(0, limit) : holders
    const rows = rawRows.map(
      (h: { fullName: string } & Record<string, unknown>) => ({
        ...h,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", h.fullName),
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
        status: status ?? null,
        searchHit: search !== null,
        fullNameFilterHit: fullNameFilter !== null,
        taxIdFilterHit: taxIdFilter !== null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ holders: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[policy-holders/lookup] POST error:", err)
    return NextResponse.json(
      { error: "Failed to look up policy holders" },
      { status: 500 },
    )
  }
})
